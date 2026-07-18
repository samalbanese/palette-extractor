import type { RGB } from './color'
import {
  colorDistanceSq,
  medianCutTrace,
  type Pixel,
  type SplitStep,
  type WeightedColor,
} from './medianCut'

/**
 * Longest edge of the downscaled working canvas. Median cut only needs a
 * statistical sample of the image, not every pixel of a 12-megapixel photo.
 */
const MAX_DIMENSION = 160

/**
 * Pixels closer than this (Euclidean RGB distance) to a locked color are
 * excluded before quantizing, so re-extraction finds colors *around* the
 * locked ones instead of re-finding them.
 */
const LOCK_EXCLUSION_DISTANCE = 60

const UNREADABLE = "Couldn't read that image. Try a JPG, PNG, WebP, or SVG."
const MAX_PLOT_PIXELS = 3000

export interface ExtractionDetail {
  colors: WeightedColor[]
  pixels: Pixel[]
  steps: SplitStep[]
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Remote images need CORS approval or the canvas becomes unreadable.
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(UNREADABLE))
    img.src = src
  })
}

/**
 * Resolve a pasted image URL to a loadable src. Tries the URL directly
 * first; if the host blocks cross-origin reads, retries through the free
 * images.weserv.nl proxy, which serves any public image with CORS enabled.
 */
export async function resolveImageUrl(url: string): Promise<string> {
  const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(url)}`
  for (const candidate of [url, proxied]) {
    try {
      await loadImage(candidate)
      return candidate
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    "Couldn't load an image from that URL. The site may be private or blocking access — try saving the image and uploading it instead."
  )
}

/**
 * Draw the image to an offscreen canvas, downscale it, and run median-cut
 * quantization to find the dominant colors. Pixels near any `exclude` color
 * (locked swatches) are removed before quantizing.
 */
export async function extractPalette(
  src: string,
  count: number,
  exclude: RGB[] = []
): Promise<RGB[]> {
  const detail = await extractPaletteDetailed(src, count, exclude)
  return detail.colors.map((entry) => entry.color)
}

export async function extractPaletteDetailed(
  src: string,
  count: number,
  exclude: RGB[] = []
): Promise<ExtractionDetail> {
  const img = await loadImage(src)
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  if (!width || !height) throw new Error(UNREADABLE)

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.drawImage(img, 0, 0, w, h)

  const { data } = ctx.getImageData(0, 0, w, h)
  const all: Pixel[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue // skip transparent pixels
    all.push([data[i], data[i + 1], data[i + 2]])
  }
  if (all.length === 0) {
    throw new Error('That image appears to be fully transparent.')
  }

  let pixels = all
  if (exclude.length > 0) {
    const limit = LOCK_EXCLUSION_DISTANCE ** 2
    const nearLocked = (p: Pixel) =>
      exclude.some(
        (c) => colorDistanceSq({ r: p[0], g: p[1], b: p[2] }, c) < limit
      )
    const filtered = all.filter((p) => !nearLocked(p))
    // If locked colors cover the whole image, fall back to every pixel
    // rather than returning nothing.
    if (filtered.length > 0) pixels = filtered
  }

  const { result, steps } = medianCutTrace(pixels, count)
  return { colors: result, pixels: uniformSample(pixels), steps }
}

function uniformSample(pixels: Pixel[]): Pixel[] {
  if (pixels.length <= MAX_PLOT_PIXELS) return [...pixels]
  const stride = pixels.length / MAX_PLOT_PIXELS
  return Array.from(
    { length: MAX_PLOT_PIXELS },
    (_, index) => pixels[Math.floor(index * stride)]
  )
}
