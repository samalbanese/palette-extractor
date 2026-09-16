import { type RGB, relativeLuminance, rgbToHsl } from "./color";
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
  const accent = [...palette].sort((a, b) => rgbToHsl(b).s - rgbToHsl(a).s)[0];
  return { background, foreground, accent, ratio };
}
