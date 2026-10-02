import type { RGB } from "./color";

/** The glow layer's own opacity, the only opacity anywhere in the glow. */
export const ATMOSPHERE_OPACITY = 0.3;
/** No glow color has an sRGB channel brighter than this. */
export const ATMOSPHERE_CMAX = 134;
/** Glow blobs drawn per palette, most populous colors first. */
export const ATMOSPHERE_BLOBS = 4;

/**
 * Scales a color toward black until its brightest channel is at most
 * ATMOSPHERE_CMAX, keeping its hue. Colors already within the cap come back
 * unchanged.
 */
export function atmosphereColor(rgb: RGB): RGB {
  const brightest = Math.max(rgb.r, rgb.g, rgb.b);
  if (brightest <= ATMOSPHERE_CMAX) return { ...rgb };
  const scale = ATMOSPHERE_CMAX / brightest;
  const channel = (value: number) =>
    Math.min(ATMOSPHERE_CMAX, Math.round(value * scale));
  return { r: channel(rgb.r), g: channel(rgb.g), b: channel(rgb.b) };
}

/**
 * The colors the glow is drawn from: the most populous few, ties kept in
 * palette order so re-sorting the swatches never changes the glow. Small
 * palettes repeat their colors so the glow keeps at least three blobs.
 */
export function atmosphereColors(
  palette: { color: RGB; population: number }[],
): RGB[] {
  if (palette.length === 0) return [];
  const top = palette
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.population - a.population || a.index - b.index)
    .slice(0, ATMOSPHERE_BLOBS)
    .map((entry) => atmosphereColor(entry.color));
  while (top.length < 3) top.push(top[top.length % palette.length]);
  return top;
}

/**
 * The brightest any channel of the page can get under the glow: the page
 * blended with colors no brighter than ATMOSPHERE_CMAX at a coverage of at
 * most ATMOSPHERE_OPACITY. `pageMax` is the page background's brightest
 * channel.
 */
export function atmosphereCeiling(pageMax: number): number {
  return Math.max(
    pageMax,
    pageMax * (1 - ATMOSPHERE_OPACITY) + ATMOSPHERE_CMAX * ATMOSPHERE_OPACITY,
  );
}
