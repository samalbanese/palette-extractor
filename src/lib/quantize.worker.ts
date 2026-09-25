import {
  colorDistanceSq,
  medianCutTrace,
  type ColorSpace,
  type Pixel,
} from "./medianCut";
import { oklabCoords } from "./oklab";
import type { RGB } from "./color";

const TRANSPARENT =
  "That image is fully transparent. Choose an image with visible pixels.";

export interface WorkerRequest {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  count: number;
  exclude: RGB[];
  colorSpace: ColorSpace;
}

function collectPixels(data: Uint8ClampedArray): Pixel[] {
  const all: Pixel[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 125) all.push([data[i], data[i + 1], data[i + 2]]);
  }
  return all;
}

/**
 * Distance used to exclude pixels near a pinned color, so re-extraction
 * finds genuinely different colors for the unpinned slots. RGB mode keeps
 * its original threshold; OKLab mode measures the same 0.1-unit tolerance
 * in the rescaled 0-255 OKLab domain instead.
 */
function isNearExcluded(
  pixel: Pixel,
  exclude: RGB[],
  colorSpace: ColorSpace,
): boolean {
  if (colorSpace === "oklab") {
    const coords = oklabCoords(pixel);
    return exclude.some((c) => {
      const excludedCoords = oklabCoords([c.r, c.g, c.b]);
      const distance =
        (coords[0] - excludedCoords[0]) ** 2 +
        (coords[1] - excludedCoords[1]) ** 2 +
        (coords[2] - excludedCoords[2]) ** 2;
      return distance < (0.1 * 255) ** 2;
    });
  }
  return exclude.some(
    (c) =>
      colorDistanceSq({ r: pixel[0], g: pixel[1], b: pixel[2] }, c) < 60 ** 2,
  );
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const request = event.data;
    const all = collectPixels(new Uint8ClampedArray(request.buffer));
    if (!all.length) throw new Error(TRANSPARENT);

    const { count, exclude, colorSpace } = request;
    const filtered = exclude.length
      ? all.filter((p) => !isNearExcluded(p, exclude, colorSpace))
      : all;
    const pixels = filtered.length ? filtered : all;
    const { result, steps } = medianCutTrace(pixels, count, { colorSpace });
    const stride = pixels.length / Math.min(pixels.length, 3000);
    const sample = Array.from(
      { length: Math.min(pixels.length, 3000) },
      (_, i) => pixels[Math.floor(i * stride)],
    );
    self.postMessage({ colors: result, pixels: sample, steps });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not extract image colors.",
    });
  }
};
