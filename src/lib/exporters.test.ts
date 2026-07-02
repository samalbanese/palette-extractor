import { describe, expect, it } from 'vitest'
import { toCssVariables, toTailwind, toJson, exportPalette } from './exporters'

const palette = [
  { r: 46, g: 49, b: 99 },
  { r: 240, g: 180, b: 94 },
  { r: 63, g: 111, b: 116 },
]

describe('toCssVariables (acceptance: valid, paste-ready CSS)', () => {
  it('produces a :root block with one variable per color', () => {
    const css = toCssVariables(palette)
    expect(css).toBe(
      ':root {\n' +
        '  --palette-1: #2e3163;\n' +
        '  --palette-2: #f0b45e;\n' +
        '  --palette-3: #3f6f74;\n' +
        '}'
    )
  })
})

describe('toTailwind (acceptance: valid, paste-ready Tailwind)', () => {
  it('produces a Tailwind v4 @theme block with color variables', () => {
    const snippet = toTailwind(palette)
    expect(snippet.startsWith('@theme {')).toBe(true)
    expect(snippet.endsWith('}')).toBe(true)
    expect(snippet).toContain('--color-palette-1: #2e3163;')
    expect(snippet).toContain('--color-palette-3: #3f6f74;')
  })
})

describe('toJson (acceptance: valid, paste-ready JSON)', () => {
  it('round-trips through JSON.parse with all three value formats', () => {
    const parsed = JSON.parse(toJson(palette))
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toEqual({
      hex: '#2e3163',
      rgb: 'rgb(46, 49, 99)',
      hsl: 'hsl(237, 37%, 28%)',
    })
  })
})

describe('exportPalette', () => {
  it('dispatches to the right formatter for each format', () => {
    expect(exportPalette(palette, 'css')).toContain(':root')
    expect(exportPalette(palette, 'tailwind')).toContain('@theme')
    expect(() => JSON.parse(exportPalette(palette, 'json'))).not.toThrow()
  })
})
