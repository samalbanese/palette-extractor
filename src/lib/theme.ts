import { type RGB, relativeLuminance, rgbToHsl } from "./color";
import { oklabDistance } from "@relaywright/median-cut";
import { contrastRatio } from "./contrast";

/** Choose roles only from the extracted palette. Never invent an accessible pair. */
export function suggestRoles(palette: RGB[]) {
  if (!palette.length) return null;
  let background = palette[0],
    foreground = palette[0],
    ratio = 1;
  for (const a of palette) {
    for (const b of palette) {
      const candidate = contrastRatio(a, b);
      if (candidate > ratio) {
        ratio = candidate;
        background = relativeLuminance(a) > relativeLuminance(b) ? a : b;
        foreground = background === a ? b : a;
      }
    }
  }
  return {
    background,
    foreground,
    accent: pickAccent(palette, background, foreground),
    ratio,
  };
}

// The accent fills a button and a sticker on either surface, so it needs to
// look clearly different from both. Measured in OKLab, where a hue change
// counts as much as a lightness change; 0.02 is about the smallest visible
// step.
const ACCENT_DISTANCE = 0.1;

/** The most saturated color that stands out from both surface colors. */
function pickAccent(palette: RGB[], background: RGB, foreground: RGB) {
  const bySaturation = (list: RGB[]) =>
    [...list].sort((a, b) => rgbToHsl(b).s - rgbToHsl(a).s);
  const others = palette.filter((c) => c !== background && c !== foreground);
  // With only the two surface colors to choose from, the accent shares one.
  if (!others.length) return bySaturation(palette)[0];
  const apart = (c: RGB) =>
    Math.min(oklabDistance(c, background), oklabDistance(c, foreground));
  const clear = others.filter((c) => apart(c) >= ACCENT_DISTANCE);
  if (clear.length) return bySaturation(clear)[0];
  return others.reduce((best, c) => (apart(c) > apart(best) ? c : best));
}
