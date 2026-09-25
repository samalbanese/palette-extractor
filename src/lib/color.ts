export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(lightness * 100) };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  if (max === rn) {
    hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    hue = ((bn - rn) / delta + 2) * 60;
  } else {
    hue = ((rn - gn) / delta + 4) * 60;
  }

  return {
    h: Math.round(hue),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

export function formatRgb({ r, g, b }: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Squared Euclidean distance in RGB space. */
export function colorDistanceSq(a: RGB, b: RGB): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

export function formatHsl(hsl: HSL): string {
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: RGB): number {
  const linear = (value: number) => {
    const n = value / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Label color that stays readable on top of the given swatch color.
 * Use opaque ink, checking the actual tint rather than assuming black/white
 * contrast. Pure black/white fills the small gap where neither tint meets AA.
 */
export function labelColorFor(rgb: RGB): string {
  const luminance = relativeLuminance(rgb);
  const dark = relativeLuminance({ r: 20, g: 18, b: 12 });
  const light = relativeLuminance({ r: 255, g: 253, b: 248 });
  if ((luminance + 0.05) / (dark + 0.05) >= 4.5) return "rgb(20, 18, 12)";
  if ((light + 0.05) / (luminance + 0.05) >= 4.5) return "rgb(255, 253, 248)";
  return luminance > 0.179 ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
}

export type SortMode = "original" | "hue" | "luminance";

export function sortPalette<T extends RGB | { color: RGB }>(
  palette: T[],
  mode: SortMode,
): T[] {
  if (mode === "original") return palette;
  const sorted = [...palette];
  const colorOf = (entry: T): RGB => ("color" in entry ? entry.color : entry);
  if (mode === "hue") {
    sorted.sort((a, b) => {
      const ha = rgbToHsl(colorOf(a));
      const hb = rgbToHsl(colorOf(b));
      // Group near-grays (very low saturation) at the end, then sort by hue.
      const aGray = ha.s < 8 ? 1 : 0;
      const bGray = hb.s < 8 ? 1 : 0;
      if (aGray !== bGray) return aGray - bGray;
      return ha.h - hb.h || ha.l - hb.l;
    });
  } else {
    sorted.sort(
      (a, b) => relativeLuminance(colorOf(b)) - relativeLuminance(colorOf(a)),
    );
  }
  return sorted;
}
