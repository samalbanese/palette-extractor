import type { RGB } from "./color";
import { oklabCoords } from "./oklab";

export type Pixel = [number, number, number];
export type ColorSpace = "rgb" | "oklab";

export interface WeightedColor {
  color: RGB;
  population: number;
}

export interface SplitStep
  extends Array<{
    bounds: { min: Pixel; max: Pixel };
    color: RGB;
    population: number;
  }> {}

export interface MedianCutOptions {
  colorSpace?: ColorSpace;
}

/** A source pixel paired with the coordinates it is split and scored by. */
interface Entry {
  pixel: Pixel;
  coords: Pixel;
}

function toEntries(pixels: Pixel[], colorSpace: ColorSpace): Entry[] {
  return pixels.map((pixel) => ({
    pixel,
    // RGB mode reuses the pixel itself as its coordinates, so every split,
    // score, and average below runs on the exact same numbers as before
    // OKLab mode existed.
    coords: colorSpace === "oklab" ? oklabCoords(pixel) : pixel,
  }));
}

/**
 * Median-cut color quantization, implemented from scratch. Repeatedly
 * splits the pixel box with the highest score at the median of its widest
 * channel, then selects a representative source pixel from each final box.
 *
 * Like the classic MMCQ algorithm, early splits are scored by population
 * (finds the dominant colors) and later splits by population x volume
 * (rescues small-but-distinct accent colors that population alone ignores).
 *
 * `options.colorSpace` chooses which coordinates the box splits and scores
 * run on: plain RGB, or OKLab rescaled into the same 0-255 domain. Either
 * way, the returned color is always a real source pixel's RGB value.
 */
export function medianCut(
  pixels: Pixel[],
  count: number,
  options?: MedianCutOptions,
): RGB[] {
  return medianCutWeighted(pixels, count, options).map((entry) => entry.color);
}

export function medianCutWeighted(
  pixels: Pixel[],
  count: number,
  options?: MedianCutOptions,
): WeightedColor[] {
  return runMedianCut(pixels, count, false, options?.colorSpace ?? "rgb")
    .result;
}

export function medianCutTrace(
  pixels: Pixel[],
  count: number,
  options?: MedianCutOptions,
): { steps: SplitStep[]; result: WeightedColor[] } {
  return runMedianCut(pixels, count, true, options?.colorSpace ?? "rgb");
}

function runMedianCut(
  pixels: Pixel[],
  count: number,
  trace: boolean,
  colorSpace: ColorSpace,
): { steps: SplitStep[]; result: WeightedColor[] } {
  if (pixels.length === 0 || count < 1) return { steps: [], result: [] };

  let boxes: Entry[][] = [toEntries(pixels, colorSpace)];
  const populationSplits = Math.ceil(count * 0.75);
  const steps: SplitStep[] = trace ? [snapshot(boxes)] : [];

  while (boxes.length < count) {
    const byVolume = boxes.length >= populationSplits;
    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      const ranges = channelRanges(box);
      const maxRange = Math.max(ranges[0], ranges[1], ranges[2]);
      if (maxRange === 0) continue; // all pixels identical; cannot split
      const volume = (ranges[0] + 1) * (ranges[1] + 1) * (ranges[2] + 1);
      const score = byVolume ? box.length * volume : box.length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) break; // nothing left to split

    const box = boxes[bestIndex];
    const ranges = channelRanges(box);
    const widest = ranges.indexOf(Math.max(ranges[0], ranges[1], ranges[2])) as
      | 0
      | 1
      | 2;
    boxes.splice(bestIndex, 1, ...splitBox(box, widest));
    if (trace) steps.push(snapshot(boxes));
  }

  const colors = boxes
    .map((box) => ({ population: box.length, color: representativeColor(box) }))
    .sort((a, b) => b.population - a.population);

  const merged = new Map<string, WeightedColor>();
  for (const entry of colors) {
    const { r, g, b } = entry.color;
    const key = `${r},${g},${b}`;
    const existing = merged.get(key);
    if (existing) existing.population += entry.population;
    else merged.set(key, { color: entry.color, population: entry.population });
  }

  return {
    steps,
    result: [...merged.values()].sort((a, b) => b.population - a.population),
  };
}

function snapshot(boxes: Entry[][]): SplitStep {
  return boxes.map((box) => ({
    bounds: channelBounds(box),
    color: representativeColor(box),
    population: box.length,
  }));
}

/**
 * Split a box along one channel. Cutting exactly at the pixel median can
 * land inside a dominant color cluster and produce muddy mixed boxes, so —
 * like the original MMCQ — the cut point is pushed from the median toward
 * the middle of the wider value range, which tends to fall in the empty
 * gap between color clusters.
 */
function splitBox(box: Entry[], channel: 0 | 1 | 2): [Entry[], Entry[]] {
  const sorted = [...box].sort((a, b) => a.coords[channel] - b.coords[channel]);
  const n = sorted.length;
  const min = sorted[0].coords[channel];
  const max = sorted[n - 1].coords[channel];
  const medianValue = sorted[Math.floor(n / 2)].coords[channel];

  const leftSpan = medianValue - min;
  const rightSpan = max - medianValue;
  const cutValue =
    leftSpan <= rightSpan
      ? Math.min(max - 1, Math.floor(medianValue + rightSpan / 2))
      : Math.max(min, Math.floor(medianValue - 1 - leftSpan / 2));

  let cutIndex = sorted.findIndex((entry) => entry.coords[channel] > cutValue);
  if (cutIndex <= 0 || cutIndex >= n) cutIndex = Math.max(1, Math.floor(n / 2));
  return [sorted.slice(0, cutIndex), sorted.slice(cutIndex)];
}

function channelRanges(box: Entry[]): [number, number, number] {
  const { min, max } = channelBounds(box);
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** Bounds are in the box's active coordinate space (RGB or OKLab). */
function channelBounds(box: Entry[]): { min: Pixel; max: Pixel } {
  let minR = 255,
    maxR = 0,
    minG = 255,
    maxG = 0,
    minB = 255,
    maxB = 0;
  for (const { coords } of box) {
    const [r, g, b] = coords;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  return { min: [minR, minG, minB], max: [maxR, maxG, maxB] };
}

function averageCoords(box: Entry[]): Pixel {
  let r = 0,
    g = 0,
    b = 0;
  for (const { coords } of box) {
    r += coords[0];
    g += coords[1];
    b += coords[2];
  }
  return [
    Math.round(r / box.length),
    Math.round(g / box.length),
    Math.round(b / box.length),
  ];
}

/**
 * A box average can fall between clusters and invent a color that appears
 * nowhere in the image, so snap to the box's source pixel whose coordinates
 * are nearest the average. Strict `<` keeps the first-encountered pixel on
 * ties. The color returned is always the source pixel's real RGB value,
 * even when the box was split on OKLab coordinates.
 */
function representativeColor(box: Entry[]): RGB {
  const [ar, ag, ab] = averageCoords(box);
  let closestIndex = 0;
  let closestDistance = Infinity;

  for (let i = 0; i < box.length; i++) {
    const [r, g, b] = box[i].coords;
    const distance = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (distance < closestDistance) {
      closestIndex = i;
      closestDistance = distance;
    }
  }

  const [r, g, b] = box[closestIndex].pixel;
  return { r, g, b };
}

/** Squared Euclidean distance in RGB space. */
export function colorDistanceSq(a: RGB, b: RGB): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}
