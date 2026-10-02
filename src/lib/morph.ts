import { oklabDistance, srgbToOklab } from "@samalbanese/median-cut";
import { type RGB, rgbToHex } from "./color";

/** How long a swatch takes to slide to a new slot or melt to a new color. */
export const MORPH_MS = 400;

/** A swatch on screen: the color it shows now and the color it is heading to. */
export interface DisplayedSwatch {
  id: string;
  rgb: RGB;
  target: RGB;
  locked: boolean;
}

export interface MorphItem {
  id: string;
  /** The color the swatch shows now; null for a new swatch. */
  from: RGB | null;
  to: RGB;
  /** False when the target is unchanged, so a running melt carries on. */
  retarget: boolean;
  fromSlot: number | null;
  toSlot: number;
}

/**
 * Pairs a new palette with the swatches on screen so each surviving swatch
 * keeps its ID. Locked colors claim the swatch already showing their hex,
 * then exact hex matches pair up (repeats in order of occurrence), then the
 * rest go to the nearest remaining swatch in OKLab, closest pair first. Only
 * target colors are compared, never a color caught mid-melt.
 */
export function planMorph(
  prev: DisplayedSwatch[],
  next: { rgb: RGB; locked: boolean }[],
  newId: () => string,
): { items: MorphItem[]; removed: string[] } {
  const targetHex = prev.map((swatch) => rgbToHex(swatch.target));
  const free = new Set(prev.keys());
  const match: (number | null)[] = next.map(() => null);
  const claim = (slot: number, index: number) => {
    match[slot] = index;
    free.delete(index);
  };
  const claimSameHex = (slot: number) => {
    const hex = rgbToHex(next[slot].rgb);
    for (const index of free)
      if (targetHex[index] === hex) return claim(slot, index);
  };
  next.forEach((color, slot) => {
    if (color.locked) claimSameHex(slot);
  });
  next.forEach((_, slot) => {
    if (match[slot] === null) claimSameHex(slot);
  });
  // Ties go to the lower next slot, then the lower previous slot.
  const pairs = next.flatMap((color, slot) =>
    match[slot] === null
      ? [...free].map((index) => ({
          slot,
          index,
          distance: oklabDistance(color.rgb, prev[index].target),
        }))
      : [],
  );
  pairs.sort(
    (a, b) => a.distance - b.distance || a.slot - b.slot || a.index - b.index,
  );
  for (const { slot, index } of pairs)
    if (match[slot] === null && free.has(index)) claim(slot, index);

  return {
    items: next.map(({ rgb }, toSlot) => {
      const fromSlot = match[toSlot];
      if (fromSlot === null)
        return {
          id: newId(),
          from: null,
          to: rgb,
          retarget: false,
          fromSlot,
          toSlot,
        };
      const old = prev[fromSlot];
      return {
        id: old.id,
        from: old.rgb,
        to: rgb,
        retarget: targetHex[fromSlot] !== rgbToHex(rgb),
        fromSlot,
        toSlot,
      };
    }),
    removed: [...free].map((index) => prev[index].id),
  };
}

/**
 * A new photo's colors arrive with the stage's flyers, so they take their
 * final values at once. Everything else (the same photo re-extracted, a
 * shared palette, a photo giving way to a shared palette) melts.
 */
export function colorChange(
  previous: object | null,
  loaded: object | null,
): "final" | "morph" {
  return loaded !== null && loaded !== previous ? "final" : "morph";
}

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/** Same curve as `easeInOutCubic`, for CSS and WAAPI timing. */
export const EASE_IN_OUT_CUBIC = "cubic-bezier(0.65, 0, 0.35, 1)";

const encode = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round(
    255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055),
  );
};

/**
 * Mixes two colors in OKLab (Ottosson's matrices). An in-between color that
 * falls outside sRGB is clipped per channel in linear light.
 */
export function mixOklab(a: RGB, b: RGB, t: number): RGB {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const start = srgbToOklab(a);
  const end = srgbToOklab(b);
  const L = start.L + (end.L - start.L) * t;
  const A = start.a + (end.a - start.a) * t;
  const B = start.b + (end.b - start.b) * t;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** A melt from one color to another, on the `performance.now()` clock. */
export interface ColorTimeline {
  from: RGB;
  to: RGB;
  start: number;
}

export const settledAt = (color: RGB): ColorTimeline => ({
  from: color,
  to: color,
  start: -Infinity,
});

export function colorAt({ from, to, start }: ColorTimeline, now: number) {
  const t = Math.min(1, Math.max(0, (now - start) / MORPH_MS));
  return mixOklab(from, to, easeInOutCubic(t));
}
