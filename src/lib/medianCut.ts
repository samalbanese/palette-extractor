import type { RGB } from './color'

export type Pixel = [number, number, number]

export interface WeightedColor {
  color: RGB
  population: number
}

export interface SplitStep extends Array<{
  bounds: { min: Pixel; max: Pixel }
  color: RGB
  population: number
}> {}

/**
 * Median-cut color quantization, implemented from scratch (spec stretch
 * goal). Repeatedly splits the pixel box with the highest score at the
 * median of its widest channel, then selects a representative source pixel
 * from each final box.
 *
 * Like the classic MMCQ algorithm, early splits are scored by population
 * (finds the dominant colors) and later splits by population x volume
 * (rescues small-but-distinct accent colors that population alone ignores).
 */
export function medianCut(pixels: Pixel[], count: number): RGB[] {
  return medianCutWeighted(pixels, count).map((entry) => entry.color)
}

export function medianCutWeighted(pixels: Pixel[], count: number): WeightedColor[] {
  return runMedianCut(pixels, count, false).result
}

export function medianCutTrace(
  pixels: Pixel[],
  count: number
): { steps: SplitStep[]; result: WeightedColor[] } {
  return runMedianCut(pixels, count, true)
}

function runMedianCut(
  pixels: Pixel[],
  count: number,
  trace: boolean
): { steps: SplitStep[]; result: WeightedColor[] } {
  if (pixels.length === 0 || count < 1) return { steps: [], result: [] }

  let boxes: Pixel[][] = [pixels]
  const populationSplits = Math.ceil(count * 0.75)
  const steps: SplitStep[] = trace ? [snapshot(boxes)] : []

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
    if (trace) steps.push(snapshot(boxes))
  }

  const colors = boxes
    .map((box) => ({ population: box.length, color: representativeColor(box) }))
    .sort((a, b) => b.population - a.population)

  const merged = new Map<string, WeightedColor>()
  for (const entry of colors) {
    const { r, g, b } = entry.color
    const key = `${r},${g},${b}`
    const existing = merged.get(key)
    if (existing) existing.population += entry.population
    else merged.set(key, { color: entry.color, population: entry.population })
  }

  return {
    steps,
    result: [...merged.values()].sort((a, b) => b.population - a.population),
  }
}

function snapshot(boxes: Pixel[][]): SplitStep {
  return boxes.map((box) => ({
    bounds: channelBounds(box),
    color: representativeColor(box),
    population: box.length,
  }))
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
  const { min, max } = channelBounds(box)
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

function channelBounds(box: Pixel[]): { min: Pixel; max: Pixel } {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0
  for (const [r, g, b] of box) {
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (g < minG) minG = g
    if (g > maxG) maxG = g
    if (b < minB) minB = b
    if (b > maxB) maxB = b
  }
  return { min: [minR, minG, minB], max: [maxR, maxG, maxB] }
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

/**
 * A box average can fall between clusters and invent a color that appears
 * nowhere in the image, so snap to the box pixel nearest the average.
 * Strict `<` keeps the first-encountered pixel on ties.
 */
function representativeColor(box: Pixel[]): RGB {
  const { r: ar, g: ag, b: ab } = averageColor(box)
  let closestIndex = 0
  let closestDistance = Infinity

  for (let i = 0; i < box.length; i++) {
    const [r, g, b] = box[i]
    const distance = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2
    if (distance < closestDistance) {
      closestIndex = i
      closestDistance = distance
    }
  }

  const [r, g, b] = box[closestIndex]
  return { r, g, b }
}

/** Squared Euclidean distance in RGB space. */
export function colorDistanceSq(a: RGB, b: RGB): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
}
