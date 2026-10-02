import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ColorSpace } from "@samalbanese/median-cut";
import type { ExtractionDetail } from "../lib/extract";
import type { Source } from "./useImageSource";

const COMPARISON_DURATION_MS = 6000;

export interface Comparison {
  changed: number;
  total: number;
  expiresAt: number;
}

/**
 * How many colors the last color space switch changed, kept for a few
 * seconds after the switch commits. It is stored apart from the swatch
 * highlight so "0 of 6" can still be shown and nothing lingers once it
 * expires. The next switch replaces it; any other commit clears it.
 */
export function useColorSpaceComparison(
  sorted: ExtractionDetail["colors"],
  colorSpace: ColorSpace,
  loaded: Source | null,
  changedHexes: Set<string>,
) {
  const previous = useRef({ sorted, colorSpace, loaded });
  const [comparison, setComparison] = useState<Comparison | null>(null);

  // Runs in the commit that shows the new palette, so the line never paints
  // a frame behind it.
  useLayoutEffect(() => {
    const prior = previous.current;
    if (prior.sorted === sorted) return;
    previous.current = { sorted, colorSpace, loaded };
    const switched =
      !!loaded && prior.loaded === loaded && prior.colorSpace !== colorSpace;
    setComparison(
      switched
        ? {
            changed: changedHexes.size,
            total: sorted.length,
            expiresAt: performance.now() + COMPARISON_DURATION_MS,
          }
        : null,
    );
  }, [sorted, colorSpace, loaded, changedHexes]);

  useEffect(() => {
    if (!comparison) return;
    const timeout = window.setTimeout(
      () => setComparison(null),
      Math.max(0, comparison.expiresAt - performance.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [comparison]);

  return comparison;
}
