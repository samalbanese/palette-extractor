import { type RGB, relativeLuminance } from "./color";

/** WCAG 2.x contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export type WcagLevel = "AAA" | "AA" | "AA Large";

export interface ContrastPair {
  /** The darker color, presented as text. */
  fg: RGB;
  /** The lighter color, presented as background. */
  bg: RGB;
  ratio: number;
  level: WcagLevel;
}

/**
 * Every unordered pair of palette colors that meets at least WCAG AA for
 * large text (ratio >= 3), strongest first. Contrast is symmetric, so each
 * pair appears once, presented with the lighter color as the background.
 */
export function readablePairs(palette: RGB[]): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      const ratio = contrastRatio(palette[i], palette[j]);
      if (ratio < 3) continue;
      const level: WcagLevel =
        ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "AA Large";
      const aIsLighter =
        relativeLuminance(palette[i]) >= relativeLuminance(palette[j]);
      pairs.push({
        bg: aIsLighter ? palette[i] : palette[j],
        fg: aIsLighter ? palette[j] : palette[i],
        ratio,
        level,
      });
    }
  }
  return pairs.sort((a, b) => b.ratio - a.ratio);
}
