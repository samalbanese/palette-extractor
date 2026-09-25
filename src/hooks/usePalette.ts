import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type RGB, type SortMode, rgbToHex, sortPalette } from "../lib/color";
import { extractPaletteDetailed, type ExtractionDetail } from "../lib/extract";
import { updatePaletteFavicon } from "../lib/favicon";
import type { ColorSpace } from "../lib/medianCut";
import type { Source } from "./useImageSource";

const HIGHLIGHT_DURATION_MS = 1500;

interface UsePaletteOptions {
  source: Source | null;
  urlBusy: boolean;
  initialColors: RGB[] | null;
  setLoaded: (source: Source) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string) => void;
  setSelectedHex: (hex: string | null) => void;
}

/**
 * Owns the extracted palette: running the quantizer worker against the
 * current source, pinning colors, choosing how many to keep, and sorting.
 */
export function usePalette({
  source,
  urlBusy,
  initialColors,
  setLoaded,
  setError,
  setNotice,
  setSelectedHex,
}: UsePaletteOptions) {
  const [detail, setDetail] = useState<ExtractionDetail>({
    colors: initialColors?.map((color) => ({ color, population: 1 })) ?? [],
    pixels: [],
    steps: [],
  });
  const [locked, setLocked] = useState<RGB[]>(initialColors ?? []);
  const [count, setCount] = useState(initialColors?.length ?? 6);
  const [sort, setSort] = useState<SortMode>("original");
  const [extracting, setExtracting] = useState(!initialColors);
  const [colorSpace, setColorSpace] = useState<ColorSpace>("rgb");
  const [changedHexes, setChangedHexes] = useState<Set<string>>(new Set());
  const previousColorSpace = useRef<ColorSpace>("rgb");
  const previousUnlockedHexes = useRef<Set<string>>(new Set());
  const highlightTimeout = useRef<number>();

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    setExtracting(true);
    const remaining = count - locked.length;
    const isSwitch = previousColorSpace.current !== colorSpace;
    const priorUnlockedHexes = previousUnlockedHexes.current;
    const run = async () => {
      // Validate each new source even when every output slot is pinned.
      const next = await extractPaletteDetailed(
        source.src,
        Math.max(1, remaining),
        locked,
        controller.signal,
        colorSpace,
      );
      if (controller.signal.aborted) return;
      const unlocked =
        remaining > 0
          ? next.colors
              .filter(
                (e) => !locked.some((c) => rgbToHex(c) === rgbToHex(e.color)),
              )
              .slice(0, remaining)
          : [];
      const unlockedHexes = new Set(unlocked.map((e) => rgbToHex(e.color)));
      // Deprioritized: lets the browser paint whatever's already on screen
      // (the source image, in particular) before committing this update.
      startTransition(() => {
        setDetail({
          ...next,
          colors: [
            ...locked.map((color) => ({ color, population: 0 })),
            ...unlocked,
          ],
          ...(remaining <= 0 ? { pixels: [], steps: [] } : {}),
        });
        setLoaded(source);
        setSelectedHex(null);
        setError(null);
        if (isSwitch) {
          const changed = new Set(
            [...unlockedHexes].filter((hex) => !priorUnlockedHexes.has(hex)),
          );
          setChangedHexes(changed);
          window.clearTimeout(highlightTimeout.current);
          highlightTimeout.current = window.setTimeout(
            () => setChangedHexes(new Set()),
            HIGHLIGHT_DURATION_MS,
          );
          const total = locked.length + unlocked.length;
          const label = colorSpace === "oklab" ? "Perceptual" : "RGB";
          setNotice(
            changed.size === 0
              ? "Same colors in both color spaces."
              : `${label} changed ${changed.size} of ${total} colors.`,
          );
        } else {
          setChangedHexes(new Set());
          setNotice(
            `${locked.length + unlocked.length} colors ready from ${source.name}.`,
          );
        }
        setExtracting(false);
      });
      previousColorSpace.current = colorSpace;
      previousUnlockedHexes.current = unlockedHexes;
    };
    void run().catch((err: Error) => {
      if (!controller.signal.aborted) {
        setError(`${err.message} Your last palette is still available.`);
        setExtracting(false);
      }
    });
    return () => controller.abort();
  }, [source, count, locked, colorSpace]);

  useEffect(() => () => window.clearTimeout(highlightTimeout.current), []);

  const sorted = useMemo(
    () => sortPalette(detail.colors, sort),
    [detail.colors, sort],
  );
  const colors = useMemo(() => sorted.map((e) => e.color), [sorted]);
  const total = sorted.reduce((sum, e) => sum + e.population, 0);
  const lockedSet = new Set(locked.map(rgbToHex));
  const busy = extracting || urlBusy;

  useEffect(() => {
    updatePaletteFavicon(colors);
  }, [colors]);

  const toggleLock = useCallback(
    (color: RGB) => {
      if (busy || !source) return;
      const hex = rgbToHex(color);
      setLocked((prev) =>
        prev.some((c) => rgbToHex(c) === hex)
          ? prev.filter((c) => rgbToHex(c) !== hex)
          : [...prev, color],
      );
    },
    [busy, source],
  );

  const bumpMinCount = useCallback(() => setCount((v) => Math.max(4, v)), []);

  const loadShared = useCallback((colors: RGB[]) => {
    setDetail({
      colors: colors.map((color) => ({ color, population: 1 })),
      pixels: [],
      steps: [],
    });
    setLocked(colors);
    setCount(colors.length);
    setExtracting(false);
    setColorSpace("rgb");
    setChangedHexes(new Set());
    previousColorSpace.current = "rgb";
    previousUnlockedHexes.current = new Set();
  }, []);

  return {
    detail,
    locked,
    setLocked,
    count,
    setCount,
    sort,
    setSort,
    busy,
    sorted,
    colors,
    total,
    lockedSet,
    toggleLock,
    bumpMinCount,
    loadShared,
    colorSpace,
    setColorSpace,
    changedHexes,
  };
}
