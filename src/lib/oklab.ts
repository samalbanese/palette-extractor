import type { RGB } from "./color";
import type { Pixel } from "./medianCut";

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB (0-255 per channel) to OKLab, using Bjorn Ottosson's published
 * matrices. L runs roughly 0-1, a and b run roughly -0.4 to 0.4.
 */
export function srgbToOklab({ r, g, b }: RGB): Oklab {
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;

  const l2 = Math.cbrt(l);
  const m2 = Math.cbrt(m);
  const s2 = Math.cbrt(s);

  return {
    L: 0.2104542553 * l2 + 0.793617785 * m2 - 0.0040720468 * s2,
    a: 1.9779984951 * l2 - 2.428592205 * m2 + 0.4505937099 * s2,
    b: 0.0259040371 * l2 + 0.7827717662 * m2 - 0.808675766 * s2,
  };
}

/**
 * Straight-line distance between two colors in OKLab. Around 0.02 is the
 * smallest difference most people notice; black to white is 1.
 */
export function oklabDistance(x: RGB, y: RGB): number {
  const a = srgbToOklab(x);
  const b = srgbToOklab(y);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/**
 * OKLab, rescaled into the same 0-255 integer domain the RGB quantizer
 * already works in, so the median cut split logic runs unchanged whichever
 * space it is given. One uniform scale factor on all three axes preserves
 * the relative perceptual distances between colors.
 */
export function oklabCoords(pixel: Pixel): Pixel {
  const { L, a, b } = srgbToOklab({ r: pixel[0], g: pixel[1], b: pixel[2] });
  return [
    Math.round(L * 255),
    Math.round((a + 0.5) * 255),
    Math.round((b + 0.5) * 255),
  ];
}
