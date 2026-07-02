import { type RGB, rgbToHex, rgbToHsl, formatRgb, formatHsl } from './color'

export type ExportFormat = 'css' | 'tailwind' | 'json'

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  css: 'CSS variables',
  tailwind: 'Tailwind',
  json: 'JSON',
}

export function toCssVariables(palette: RGB[]): string {
  const lines = palette.map(
    (color, i) => `  --palette-${i + 1}: ${rgbToHex(color)};`
  )
  return `:root {\n${lines.join('\n')}\n}`
}

/** Tailwind v4 @theme block; drop it into the main CSS file. */
export function toTailwind(palette: RGB[]): string {
  const lines = palette.map(
    (color, i) => `  --color-palette-${i + 1}: ${rgbToHex(color)};`
  )
  return `@theme {\n${lines.join('\n')}\n}`
}

export function toJson(palette: RGB[]): string {
  const entries = palette.map((color) => ({
    hex: rgbToHex(color),
    rgb: formatRgb(color),
    hsl: formatHsl(rgbToHsl(color)),
  }))
  return JSON.stringify(entries, null, 2)
}

export function exportPalette(palette: RGB[], format: ExportFormat): string {
  switch (format) {
    case 'css':
      return toCssVariables(palette)
    case 'tailwind':
      return toTailwind(palette)
    case 'json':
      return toJson(palette)
  }
}
