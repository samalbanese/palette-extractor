import { describe, expect, it } from 'vitest'
import { decodePaletteHash, encodePaletteHash } from './share'

const palette = [
  { r: 170, g: 187, b: 204 },
  { r: 17, g: 34, b: 51 },
  { r: 254, g: 254, b: 254 },
  { r: 64, g: 61, b: 55 },
]

describe('palette share hashes', () => {
  it('encodes a compact lowercase hash and round-trips it', () => {
    expect(encodePaletteHash(palette)).toBe('#p=aabbcc.112233.fefefe.403d37')
    expect(decodePaletteHash(encodePaletteHash(palette))).toEqual(palette)
    expect(decodePaletteHash('p=AABBCC.112233.FEFEFE.403D37')).toEqual(palette)
  })

  it('accepts the app count range of 4 to 10 colors and nothing outside it', () => {
    const hashOf = (n: number) =>
      `#p=${Array.from({ length: n }, () => 'aabbcc').join('.')}`
    expect(decodePaletteHash(hashOf(4))).toHaveLength(4)
    expect(decodePaletteHash(hashOf(10))).toHaveLength(10)
    expect(decodePaletteHash(hashOf(3))).toBeNull()
    expect(decodePaletteHash(hashOf(11))).toBeNull()
  })

  it.each([
    '#p=',
    'junk',
    '#p=aabbcc',
    '#p=aabbcc.112233',
    '#p=aabbcc.11223z.fefefe.403d37',
    '#p=aabbcc.112233.fefef.403d37',
    '#p=aabbcc..112233.fefefe.403d37',
    '#p=aabbcc.112233.fefefe.403d37&x=1',
  ])('rejects malformed input: %s', (hash) => {
    expect(decodePaletteHash(hash)).toBeNull()
  })
})
