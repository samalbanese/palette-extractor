declare module 'quantize' {
  type Pixel = [number, number, number]

  interface ColorMap {
    palette(): Pixel[]
    map(pixel: Pixel): Pixel
  }

  /**
   * Median-cut color quantization (the algorithm inside ColorThief).
   * Returns false when given no pixels or an invalid color count.
   */
  export default function quantize(
    pixels: Pixel[],
    maxColors: number
  ): ColorMap | false
}
