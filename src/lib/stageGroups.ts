import { oklabDistance } from "@samalbanese/median-cut";
import { rgbToHex, type RGB } from "./color";
import type { StageSamples } from "./extraction";

/** Marks a group with no swatch on screen. */
export const NO_SWATCH = 255;

/**
 * Maps each extraction group to the swatch it belongs to on screen. The
 * palette on screen is reordered (locked colors first, then any sort), and
 * an extracted color equal to a locked one is dropped, so groups are matched
 * by color: the swatch with the same hex, otherwise the nearest in OKLab.
 */
export function swatchForGroup(
  groupColors: RGB[],
  swatches: RGB[],
): Uint8Array {
  const map = new Uint8Array(groupColors.length).fill(NO_SWATCH);
  if (!swatches.length) return map;
  const hexes = swatches.map(rgbToHex);
  groupColors.forEach((color, group) => {
    const exact = hexes.indexOf(rgbToHex(color));
    if (exact >= 0) {
      map[group] = exact;
      return;
    }
    let best = 0;
    let bestDistance = Infinity;
    swatches.forEach((swatch, i) => {
      const distance = oklabDistance(color, swatch);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    map[group] = best;
  });
  return map;
}

/** Samples for a palette with no split history (every slot locked). */
export function withoutBoxes(samples: StageSamples): StageSamples {
  return { ...samples, boxes: new Uint8Array(0) };
}
