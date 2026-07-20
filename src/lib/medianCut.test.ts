import { describe, expect, it } from 'vitest'
import {
  medianCut,
  medianCutTrace,
  medianCutWeighted,
  colorDistanceSq,
  type Pixel,
} from './medianCut'

/** Build a cluster of n pixels tightly scattered around a center color. */
function cluster(center: [number, number, number], n: number, spread = 6): Pixel[] {
  const pixels: Pixel[] = []
  for (let i = 0; i < n; i++) {
    const jitter = (channel: number) =>
      Math.min(255, Math.max(0, channel + ((i * 7) % (spread * 2)) - spread))
    pixels.push([jitter(center[0]), jitter(center[1]), jitter(center[2])])
  }
  return pixels
}

const near = (a: { r: number; g: number; b: number }, c: [number, number, number]) =>
  colorDistanceSq(a, { r: c[0], g: c[1], b: c[2] }) < 20 ** 2

describe('medianCut', () => {
  it('returns a source color instead of an off-image average for one mixed box', () => {
    const red: Pixel = [250, 10, 10]
    const blue: Pixel = [10, 10, 250]
    const pixels = [
      ...Array.from({ length: 20 }, () => red),
      ...Array.from({ length: 20 }, () => blue),
    ]

    const [color] = medianCut(pixels, 1)

    expect([red, blue]).toContainEqual([color.r, color.g, color.b])
    expect(color).toEqual({ r: red[0], g: red[1], b: red[2] })
    expect(color).not.toEqual({ r: 130, g: 10, b: 130 })
  })

  it('returns only colors present in a mixed source pixel set', () => {
    const pixels: Pixel[] = [
      ...cluster([230, 25, 35], 17, 5),
      ...cluster([30, 210, 80], 13, 7),
      ...cluster([45, 65, 225], 11, 4),
      ...cluster([235, 205, 30], 9, 6),
    ]
    const sourceColors = new Set(pixels.map((pixel) => pixel.join(',')))

    for (const count of [1, 3, 8]) {
      const palette = medianCut(pixels, count)
      for (const { r, g, b } of palette) {
        expect(sourceColors.has(`${r},${g},${b}`)).toBe(true)
      }
    }
  })

  it('recovers well-separated color clusters', () => {
    const red: [number, number, number] = [200, 30, 30]
    const green: [number, number, number] = [30, 200, 30]
    const blue: [number, number, number] = [30, 30, 200]
    const pixels = [...cluster(red, 500), ...cluster(green, 300), ...cluster(blue, 200)]
    const palette = medianCut(pixels, 3)
    expect(palette).toHaveLength(3)
    expect(palette.some((c) => near(c, red))).toBe(true)
    expect(palette.some((c) => near(c, green))).toBe(true)
    expect(palette.some((c) => near(c, blue))).toBe(true)
  })

  it('orders results by population (dominant color first)', () => {
    const pixels = [...cluster([240, 240, 240], 900), ...cluster([20, 20, 20], 100)]
    const palette = medianCut(pixels, 2)
    expect(palette[0].r).toBeGreaterThan(200) // the dominant light cluster leads
  })

  it('returns at most the requested count, all distinct', () => {
    const pixels = [
      ...cluster([200, 30, 30], 100),
      ...cluster([30, 200, 30], 100),
      ...cluster([30, 30, 200], 100),
      ...cluster([220, 220, 40], 100),
    ]
    for (const count of [4, 6, 10]) {
      const palette = medianCut(pixels, count)
      expect(palette.length).toBeLessThanOrEqual(count)
      const keys = palette.map((c) => `${c.r},${c.g},${c.b}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('handles a single-color image without infinite looping', () => {
    const pixels: Pixel[] = Array.from({ length: 50 }, () => [120, 60, 180])
    expect(medianCut(pixels, 6)).toEqual([{ r: 120, g: 60, b: 180 }])
  })

  it('handles empty input and zero count', () => {
    expect(medianCut([], 6)).toEqual([])
    expect(medianCut([[1, 2, 3]], 0)).toEqual([])
  })

  it('finds a small accent cluster among a dominant background', () => {
    // 95% near-white background, 5% saturated red accent.
    const pixels = [...cluster([245, 244, 240], 1900, 4), ...cluster([210, 40, 50], 100, 4)]
    const palette = medianCut(pixels, 5)
    expect(palette.some((c) => near(c, [210, 40, 50]))).toBe(true)
  })

  it('does not mutate the input array', () => {
    const pixels = [...cluster([200, 30, 30], 50), ...cluster([30, 30, 200], 50)]
    const copy = pixels.map((p) => [...p])
    medianCut(pixels, 4)
    expect(pixels.map((p) => [...p])).toEqual(copy)
  })
})

describe('weighted median cut and trace', () => {
  it('preserves population totals, ordering, and the final split state', () => {
    const pixels = [
      ...cluster([220, 30, 30], 500),
      ...cluster([30, 190, 70], 300),
      ...cluster([40, 70, 220], 200),
    ]
    const weighted = medianCutWeighted(pixels, 3)
    expect(weighted.reduce((sum, entry) => sum + entry.population, 0)).toBe(
      pixels.length
    )
    expect(weighted.map((entry) => entry.population)).toEqual(
      [...weighted].map((entry) => entry.population).sort((a, b) => b - a)
    )

    const traced = medianCutTrace(pixels, 3)
    expect(traced.steps[0]).toHaveLength(1)
    expect(traced.steps[traced.steps.length - 1]).toHaveLength(
      traced.result.length
    )
    const sourceColors = new Set(pixels.map((pixel) => pixel.join(',')))
    for (const step of traced.steps) {
      for (const { color } of step) {
        expect(sourceColors.has(`${color.r},${color.g},${color.b}`)).toBe(true)
      }
    }
    expect(traced.result).toEqual(weighted)
  })

  it('sums populations when final boxes average to an identical color', () => {
    const pixels: Pixel[] = [
      [0, 0, 0],
      [0, 0, 2],
      [0, 2, 0],
      [0, 2, 2],
    ]
    const result = medianCutWeighted(pixels, 4)
    expect(result.reduce((sum, entry) => sum + entry.population, 0)).toBe(4)
  })
})
