import { colorDistanceSq, medianCutTrace, type Pixel } from "./medianCut";
import type { RGB } from "./color";

const TRANSPARENT =
  "That image is fully transparent. Choose an image with visible pixels.";

export interface WorkerRequest {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  count: number;
  exclude: RGB[];
}

function collectPixels(data: Uint8ClampedArray): Pixel[] {
  const all: Pixel[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 125) all.push([data[i], data[i + 1], data[i + 2]]);
  }
  return all;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const request = event.data;
    const all = collectPixels(new Uint8ClampedArray(request.buffer));
    if (!all.length) throw new Error(TRANSPARENT);

    const { count, exclude } = request;
    const filtered = exclude.length
      ? all.filter(
          (p) =>
            !exclude.some(
              (c) =>
                colorDistanceSq({ r: p[0], g: p[1], b: p[2] }, c) < 60 ** 2,
            ),
        )
      : all;
    const pixels = filtered.length ? filtered : all;
    const { result, steps } = medianCutTrace(pixels, count);
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
