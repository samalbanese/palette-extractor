import { describe, expect, it } from 'vitest'
import {
  rgbToHex,
  rgbToHsl,
  formatRgb,
  formatHsl,
  relativeLuminance,
  labelColorFor,
  sortPalette,
} from './color'

describe('rgbToHex', () => {
  it('converts channels to lowercase hex with padding', () => {
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff')
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000')
    expect(rgbToHex({ r: 170, g: 187, b: 204 })).toBe('#aabbcc')
    expect(rgbToHex({ r: 15, g: 8, b: 1 })).toBe('#0f0801')
  })
})

describe('rgbToHsl', () => {
  it('converts primary colors', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 })
    expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 })
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 })
  })

  it('handles achromatic colors without NaN', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50 })
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 })
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 })
  })
})

describe('value formatting', () => {
  it('produces paste-ready CSS color syntax', () => {
    expect(formatRgb({ r: 46, g: 49, b: 99 })).toBe('rgb(46, 49, 99)')
    expect(formatHsl({ h: 237, s: 37, l: 28 })).toBe('hsl(237, 37%, 28%)')
  })
})

describe('luminance-aware labels (acceptance: readable on light and dark)', () => {
  it('uses dark text on light swatches and light text on dark swatches', () => {
    const darkLabel = labelColorFor({ r: 250, g: 245, b: 235 })
    const lightLabel = labelColorFor({ r: 20, g: 22, b: 40 })
    expect(darkLabel).not.toBe(lightLabel)
    expect(darkLabel).toContain('20, 18, 12') // dark ink on light background
    expect(lightLabel).toContain('255, 253, 248') // light ink on dark background
  })

  it('picks dark text on tricky mid-tone colors where dark has more contrast', () => {
    // Salmon (#d18882): luminance ~0.32 — dark text contrast ~7:1, white ~2.5:1.
    expect(labelColorFor({ r: 209, g: 136, b: 130 })).toContain('20, 18, 12')
    // Muted sage (#7d857a): luminance ~0.23 — dark text still wins.
    expect(labelColorFor({ r: 125, g: 133, b: 122 })).toContain('20, 18, 12')
  })

  it('computes WCAG relative luminance at the extremes', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1)
  })
})

describe('sortPalette', () => {
  const palette = [
    { r: 20, g: 20, b: 20 }, // near-black
    { r: 240, g: 240, b: 240 }, // near-white
    { r: 200, g: 40, b: 40 }, // red
    { r: 40, g: 60, b: 200 }, // blue
  ]

  it('returns the original order untouched', () => {
    expect(sortPalette(palette, 'original')).toEqual(palette)
  })

  it('sorts light to dark by luminance', () => {
    const sorted = sortPalette(palette, 'luminance')
    expect(sorted[0]).toEqual({ r: 240, g: 240, b: 240 })
    expect(sorted[sorted.length - 1]).toEqual({ r: 20, g: 20, b: 20 })
  })

  it('sorts by hue with grays grouped at the end', () => {
    const sorted = sortPalette(palette, 'hue')
    const redIndex = sorted.findIndex((c) => c.r === 200)
    const blueIndex = sorted.findIndex((c) => c.b === 200)
    expect(redIndex).toBeLessThan(blueIndex)
    expect(sorted[sorted.length - 1].r).toBe(sorted[sorted.length - 1].g) // a gray is last
  })

  it('does not mutate the input array', () => {
    const copy = [...palette]
    sortPalette(palette, 'luminance')
    expect(palette).toEqual(copy)
  })
})
