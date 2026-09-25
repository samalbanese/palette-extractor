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
 * Builds the test for pixels too close to a pinned color, so re-extraction
 * finds genuinely different colors for the unpinned slots. RGB mode keeps
 * its original threshold; OKLab mode uses a 0.1-unit tolerance, measured in
 * the rescaled 0-255 OKLab domain. Pinned colors are converted once here
 * rather than once per pixel.
 */
function nearPinned(
  exclude: RGB[],
  colorSpace: ColorSpace,
): (pixel: Pixel) => boolean {
  if (colorSpace === "oklab") {
    const pinned = exclude.map((c) => oklabCoords([c.r, c.g, c.b]));
    const limit = (0.1 * 255) ** 2;
    return (pixel) => {
      const [l, a, b] = oklabCoords(pixel);
      return pinned.some(
        (p) => (l - p[0]) ** 2 + (a - p[1]) ** 2 + (b - p[2]) ** 2 < limit,
      );
    };
  }
  return (pixel) =>
    exclude.some(
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
    const isNearPinned = nearPinned(exclude, colorSpace);
    const filtered = exclude.length ? all.filter((p) => !isNearPinned(p)) : all;
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
