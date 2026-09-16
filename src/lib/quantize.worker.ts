import { colorDistanceSq, medianCutTrace, type Pixel } from "./medianCut";
import type { RGB } from "./color";

self.onmessage = (
  event: MessageEvent<{ all: Pixel[]; count: number; exclude: RGB[] }>,
) => {
  try {
    const { all, count, exclude } = event.data;
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
