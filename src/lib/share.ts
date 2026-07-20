import { type RGB, rgbToHex } from './color'

export function encodePaletteHash(palette: RGB[]): string {
  return `#p=${palette.map((color) => rgbToHex(color).slice(1)).join('.')}`
}

export function decodePaletteHash(hash: string): RGB[] | null {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash
  // 4–10 colors, matching the app's palette count range.
  if (!/^p=(?:[0-9a-fA-F]{6})(?:\.[0-9a-fA-F]{6}){3,9}$/.test(normalized)) {
    return null
  }
  return normalized.slice(2).split('.').map((hex) => ({
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }))
}
