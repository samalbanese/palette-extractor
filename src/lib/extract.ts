import quantize from 'quantize'
import type { RGB } from './color'

/**
 * Longest edge of the downscaled working canvas. Median cut only needs a
 * statistical sample of the image, not every pixel of a 12-megapixel photo.
 */
const MAX_DIMENSION = 160

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error("Couldn't read that image. Try a JPG, PNG, WebP, or SVG."))
    img.src = src
  })
}

/**
 * Draw the image to an offscreen canvas, downscale it, and run median-cut
 * quantization to find the dominant colors.
 */
export async function extractPalette(src: string, count: number): Promise<RGB[]> {
  const img = await loadImage(src)
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  if (!width || !height) {
    throw new Error("Couldn't read that image. Try a JPG, PNG, WebP, or SVG.")
  }

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
  const pixels: [number, number, number][] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue // skip transparent pixels
    pixels.push([data[i], data[i + 1], data[i + 2]])
  }
  if (pixels.length === 0) {
    throw new Error('That image appears to be fully transparent.')
  }

  const colorMap = quantize(pixels, count)
  if (!colorMap) {
    throw new Error("Couldn't extract colors from that image.")
  }

  const seen = new Set<string>()
  const palette: RGB[] = []
  for (const [r, g, b] of colorMap.palette()) {
    const key = `${r},${g},${b}`
    if (seen.has(key)) continue
    seen.add(key)
    palette.push({ r, g, b })
    if (palette.length === count) break
  }
  return palette
}
