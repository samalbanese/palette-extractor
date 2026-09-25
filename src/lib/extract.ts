import type { RGB } from "./color";
import type { ColorSpace, Pixel, SplitStep, WeightedColor } from "./medianCut";
import type { WorkerRequest } from "./quantize.worker";
const MAX_DIMENSION = 320;
const UNREADABLE = "Couldn't read that image. Try a JPG, PNG, WebP, or SVG.";
export interface ExtractionDetail {
  colors: WeightedColor[];
  pixels: Pixel[];
  steps: SplitStep[];
}

export function loadImage(
  src: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      img.onload = null;
      img.onerror = null;
    };
    const fail = (error: Error) => {
      cleanup();
      img.src = "";
      reject(error);
    };
    const abort = () =>
      fail(new DOMException("Image loading cancelled.", "AbortError"));
    const timeout = setTimeout(
      () =>
        fail(
          new Error(
            "That image took too long to load. Try downloading it and uploading the file.",
          ),
        ),
      15000,
    );
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => fail(new Error(UNREADABLE));
    img.src = src;
  });
}

export async function resolveImageUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Use an http:// or https:// image URL.");
  for (const candidate of [
    parsed.href,
    `https://images.weserv.nl/?url=${encodeURIComponent(parsed.href)}`,
  ]) {
    try {
      await loadImage(candidate);
      return candidate;
    } catch {
      /* Try a CORS-enabled image proxy. */
    }
  }
  throw new Error(
    "Couldn't load that image URL. Try saving the image and uploading it instead.",
  );
}

export async function extractPalette(
  src: string,
  count: number,
  exclude: RGB[] = [],
): Promise<RGB[]> {
  return (await extractPaletteDetailed(src, count, exclude)).colors.map(
    (entry) => entry.color,
  );
}

/**
 * Draws the downscaled image and packages its raw RGBA buffer for the
 * quantizer worker. The buffer is transferred rather than copied, and the
 * worker builds the pixel list itself, so the main thread never allocates
 * one array per pixel. Drawing stays on a main-thread canvas because
 * OffscreenCanvas in a worker can resample to slightly different pixels.
 */
function buildWorkerRequest(
  img: HTMLImageElement,
  width: number,
  height: number,
  count: number,
  exclude: RGB[],
  colorSpace: ColorSpace,
): { request: WorkerRequest; transfer: Transferable[] } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(img, 0, 0, width, height);
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    throw new Error(UNREADABLE);
  }
  return {
    request: {
      buffer: imageData.data.buffer,
      width,
      height,
      count,
      exclude,
      colorSpace,
    },
    transfer: [imageData.data.buffer],
  };
}

export async function extractPaletteDetailed(
  src: string,
  count: number,
  exclude: RGB[] = [],
  signal?: AbortSignal,
  colorSpace: ColorSpace = "rgb",
): Promise<ExtractionDetail> {
  const img = await loadImage(src, signal);
  const width = img.naturalWidth || img.width,
    height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error(UNREADABLE);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const canvasWidth = Math.max(1, Math.round(width * scale));
  const canvasHeight = Math.max(1, Math.round(height * scale));

  const { request, transfer } = buildWorkerRequest(
    img,
    canvasWidth,
    canvasHeight,
    count,
    exclude,
    colorSpace,
  );

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Extraction cancelled.", "AbortError"));
      return;
    }
    const worker = new Worker(
      new URL("./quantize.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Extraction cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<ExtractionDetail & { error?: string }>,
    ) => {
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Color extraction could not start. Reload the page and try again.",
        ),
      );
    };
    worker.postMessage(request, transfer);
  });
}
