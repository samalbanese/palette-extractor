import {
  medianCutTrace,
  oklabCoords,
  type ColorSpace,
  type Pixel,
  type SplitStep,
  type WeightedColor,
} from "@relaywright/median-cut";
import { colorDistanceSq, type RGB } from "./color";

const TRANSPARENT =
  "That image is fully transparent. Choose an image with visible pixels.";

/** Most points the color-space view will ever draw. */
export const STAGE_SAMPLE_LIMIT = 20000;
/** Box index for pixels left out of the run because they match a locked color. */
export const PINNED_BOX = 255;
const CUBE_SAMPLE_LIMIT = 3000;

export interface WorkerRequest {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  count: number;
  exclude: RGB[];
  colorSpace: ColorSpace;
}

/**
 * Evenly spaced pixels from the working image, with where each sits and
 * where the quantizer put it. `groups` index `groupColors`, which lists the
 * extracted colors followed by the locked ones.
 */
export interface StageSamples {
  width: number;
  height: number;
  positions: Uint16Array;
  colors: Uint8Array;
  groups: Uint8Array;
  boxes: Uint8Array;
  groupColors: RGB[];
  /**
   * The color range of every pixel, in the quantizer's 0-255 coordinates for
   * the run's color space. Present only when sampling skipped pixels: a rare
   * color can then be missing from the samples while the split boxes still
   * reach it, so views fit to this range as well.
   */
  extent?: { min: Pixel; max: Pixel };
}

export interface ExtractionMessage {
  colors: WeightedColor[];
  pixels: Pixel[];
  steps: SplitStep[];
  samples: StageSamples;
}

/** The smallest box, in the quantizer's coordinates, holding every pixel. */
function colorExtent(pixels: Pixel[], colorSpace: ColorSpace) {
  const min: Pixel = [255, 255, 255];
  const max: Pixel = [0, 0, 0];
  for (const pixel of pixels) {
    const c = colorSpace === "oklab" ? oklabCoords(pixel) : pixel;
    for (let k = 0; k < 3; k++) {
      if (c[k] < min[k]) min[k] = c[k];
      if (c[k] > max[k]) max[k] = c[k];
    }
  }
  return { min, max };
}

/**
 * Returns the index of the first locked color a pixel is too close to, or
 * -1. RGB mode keeps its original threshold; OKLab mode uses a 0.1-unit
 * tolerance, measured in the rescaled 0-255 OKLab domain. Locked colors are
 * converted once here rather than once per pixel.
 */
function lockOwner(
  exclude: RGB[],
  colorSpace: ColorSpace,
): (pixel: Pixel) => number {
  if (colorSpace === "oklab") {
    const pinned = exclude.map((c) => oklabCoords([c.r, c.g, c.b]));
    const limit = (0.1 * 255) ** 2;
    return (pixel) => {
      const [l, a, b] = oklabCoords(pixel);
      return pinned.findIndex(
        (p) => (l - p[0]) ** 2 + (a - p[1]) ** 2 + (b - p[2]) ** 2 < limit,
      );
    };
  }
  return (pixel) =>
    exclude.findIndex(
      (c) =>
        colorDistanceSq({ r: pixel[0], g: pixel[1], b: pixel[2] }, c) < 60 ** 2,
    );
}

export function runExtraction(request: WorkerRequest): {
  message: ExtractionMessage;
  transfer: ArrayBuffer[];
} {
  const { width, height, count, exclude, colorSpace } = request;
  const data = new Uint8ClampedArray(request.buffer);

  // Raster index of every opaque pixel, and its color.
  const raster: number[] = [];
  const all: Pixel[] = [];
  for (let q = 0; q * 4 < data.length; q++) {
    const i = q * 4;
    if (data[i + 3] >= 125) {
      raster.push(q);
      all.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (!all.length) throw new Error(TRANSPARENT);

  // Pixels near a locked color sit out the run so the free slots find new
  // colors, unless that would leave nothing to quantize.
  const owners = exclude.length
    ? all.map(lockOwner(exclude, colorSpace))
    : null;
  const keep = owners ? owners.filter((owner) => owner < 0).length : all.length;
  const useAll = !owners || keep === 0;
  const inputIndex = new Int32Array(all.length).fill(-1);
  const pixels: Pixel[] = [];
  for (let o = 0; o < all.length; o++) {
    if (useAll || owners![o] < 0) {
      inputIndex[o] = pixels.length;
      pixels.push(all[o]);
    }
  }

  const { result, steps, assignments } = medianCutTrace(pixels, count, {
    colorSpace,
    assignments: true,
  });

  const cubeCount = Math.min(pixels.length, CUBE_SAMPLE_LIMIT);
  const stride = pixels.length / cubeCount;
  const cubePixels = Array.from(
    { length: cubeCount },
    (_, i) => pixels[Math.floor(i * stride)],
  );

  const n = Math.min(all.length, STAGE_SAMPLE_LIMIT);
  const stepCount = steps.length;
  const positions = new Uint16Array(n * 2);
  const colors = new Uint8Array(n * 3);
  const groups = new Uint8Array(n);
  const boxes = new Uint8Array(stepCount * n);
  for (let i = 0; i < n; i++) {
    const o = Math.floor((i * all.length) / n);
    const q = raster[o];
    positions[2 * i] = q % width;
    positions[2 * i + 1] = Math.floor(q / width);
    colors.set(all[o], 3 * i);
    const input = inputIndex[o];
    groups[i] =
      input >= 0 ? assignments!.groups[input] : result.length + owners![o];
    for (let k = 0; k < stepCount; k++)
      boxes[k * n + i] =
        input >= 0 ? assignments!.boxes[k * pixels.length + input] : PINNED_BOX;
  }

  const samples: StageSamples = {
    width,
    height,
    positions,
    colors,
    groups,
    boxes,
    groupColors: [...result.map((entry) => entry.color), ...exclude],
    ...(n < all.length && { extent: colorExtent(all, colorSpace) }),
  };
  return {
    message: { colors: result, pixels: cubePixels, steps, samples },
    transfer: [positions.buffer, colors.buffer, groups.buffer, boxes.buffer],
  };
}
