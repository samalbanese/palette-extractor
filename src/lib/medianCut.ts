import type { RGB } from './color'

export type Pixel = [number, number, number]

/**
 * Median-cut color quantization, implemented from scratch (spec stretch
 * goal). Repeatedly splits the pixel box with the highest score at the
 * median of its widest channel, then averages each final box.
 *
 * Like the classic MMCQ algorithm, early splits are scored by population
 * (finds the dominant colors) and later splits by population x volume
 * (rescues small-but-distinct accent colors that population alone ignores).
 */
export function medianCut(pixels: Pixel[], count: number): RGB[] {
  if (pixels.length === 0 || count < 1) return []

  let boxes: Pixel[][] = [pixels]
  const populationSplits = Math.ceil(count * 0.75)

  while (boxes.length < count) {
    const byVolume = boxes.length >= populationSplits
    let bestIndex = -1
    let bestScore = -1

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      const ranges = channelRanges(box)
      const maxRange = Math.max(ranges[0], ranges[1], ranges[2])
      if (maxRange === 0) continue // all pixels identical; cannot split
      const volume = (ranges[0] + 1) * (ranges[1] + 1) * (ranges[2] + 1)
      const score = byVolume ? box.length * volume : box.length
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    if (bestIndex === -1) break // nothing left to split

    const box = boxes[bestIndex]
    const ranges = channelRanges(box)
    const widest = ranges.indexOf(Math.max(ranges[0], ranges[1], ranges[2])) as
      | 0
      | 1
      | 2
    boxes.splice(bestIndex, 1, ...splitBox(box, widest))
  }

  const colors = boxes
    .map((box) => ({ population: box.length, color: averageColor(box) }))
    .sort((a, b) => b.population - a.population)
    .map((entry) => entry.color)

  const seen = new Set<string>()
  return colors.filter(({ r, g, b }) => {
    const key = `${r},${g},${b}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Split a box along one channel. Cutting exactly at the pixel median can
 * land inside a dominant color cluster and produce muddy mixed boxes, so —
 * like the original MMCQ — the cut point is pushed from the median toward
 * the middle of the wider value range, which tends to fall in the empty
 * gap between color clusters.
 */
function splitBox(box: Pixel[], channel: 0 | 1 | 2): [Pixel[], Pixel[]] {
  const sorted = [...box].sort((a, b) => a[channel] - b[channel])
  const n = sorted.length
  const min = sorted[0][channel]
  const max = sorted[n - 1][channel]
  const medianValue = sorted[Math.floor(n / 2)][channel]

  const leftSpan = medianValue - min
  const rightSpan = max - medianValue
  const cutValue =
    leftSpan <= rightSpan
      ? Math.min(max - 1, Math.floor(medianValue + rightSpan / 2))
      : Math.max(min, Math.floor(medianValue - 1 - leftSpan / 2))

  let cutIndex = sorted.findIndex((p) => p[channel] > cutValue)
  if (cutIndex <= 0 || cutIndex >= n) cutIndex = Math.max(1, Math.floor(n / 2))
  return [sorted.slice(0, cutIndex), sorted.slice(cutIndex)]
}

function channelRanges(box: Pixel[]): [number, number, number] {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0
  for (const [r, g, b] of box) {
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (g < minG) minG = g
    if (g > maxG) maxG = g
    if (b < minB) minB = b
    if (b > maxB) maxB = b
  }
  return [maxR - minR, maxG - minG, maxB - minB]
}

function averageColor(box: Pixel[]): RGB {
  let r = 0, g = 0, b = 0
  for (const pixel of box) {
    r += pixel[0]
    g += pixel[1]
    b += pixel[2]
  }
  return {
    r: Math.round(r / box.length),
    g: Math.round(g / box.length),
    b: Math.round(b / box.length),
  }
}

/** Squared Euclidean distance in RGB space. */
export function colorDistanceSq(a: RGB, b: RGB): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
}
