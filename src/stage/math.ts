import {
  oklabCoords,
  type ColorSpace,
  type Pixel,
} from "@samalbanese/median-cut";
import { NO_SWATCH } from "../lib/stageGroups";

/**
 * A point in the color cube, centered on 0 (each axis -127.5..127.5), or the
 * same point in view units once fitted.
 */
export type Vec3 = [number, number, number];

export interface Cover {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** The mapping CSS `object-fit: cover` applies to a centered image. */
export function coverTransform(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): Cover {
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  return {
    scale,
    offsetX: (frameWidth - imageWidth * scale) / 2,
    offsetY: (frameHeight - imageHeight * scale) / 2,
  };
}

/** Where the center of a working-image pixel lands in the frame. */
export function imagePoint(
  x: number,
  y: number,
  cover: Cover,
): [number, number] {
  return [
    cover.offsetX + (x + 0.5) * cover.scale,
    cover.offsetY + (y + 0.5) * cover.scale,
  ];
}

/**
 * A color's position in the cube for the given space, centered on 0;
 * `fitPoint` then places it in the view.
 */
export function colorPoint(rgb: Pixel, colorSpace: ColorSpace): Vec3 {
  const c = colorSpace === "oklab" ? oklabCoords(rgb) : rgb;
  return [c[0] - 127.5, c[1] - 127.5, c[2] - 127.5];
}

/**
 * How a sample set sits in the frame: points are moved so `center` (their
 * mean) is the origin, then scaled by `zoom` into view units.
 */
export interface ViewFit {
  center: Vec3;
  zoom: number;
}

/** The radius, in view units, of every fitted cloud. */
export const VIEW_RADIUS = 128;
/** Share of the frame's shorter side the fitted radius spans. */
export const FIT_SHARE = 0.42;
/** CSS pixels kept clear between the cloud and the frame edge. */
export const FRAME_MARGIN = 22;
/**
 * A cloud narrower than this many cube units is not zoomed further, so a
 * near-flat image shows as a small cluster instead of magnified noise.
 */
const MIN_RADIUS = 12;
/**
 * How far past the fitted radius a box corner may reach. Points stay inside
 * the margin; box outlines may run into it but never past the frame edge,
 * since 0.42 * 1.15 < 0.5.
 */
const BOX_REACH = 1.15;

/**
 * Centers a cloud on its mean and scales it so the farthest point sits at
 * VIEW_RADIUS. The farthest point, rather than a percentile, sets the radius
 * so that no point ever leaves the frame at any rotation: the projection
 * never moves a point farther from the center than it is in the cube. The
 * radius also grows to keep the bounding box's corners, where the split
 * boxes start, within BOX_REACH of it.
 */
export function fitView(cube: Float32Array): ViewFit {
  const n = cube.length / 3;
  const center: Vec3 = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const v = cube[i * 3 + k];
      center[k] += v / n;
      min[k] = Math.min(min[k], v);
      max[k] = Math.max(max[k], v);
    }
  let farthest = 0;
  for (let i = 0; i < n; i++)
    farthest = Math.max(
      farthest,
      Math.hypot(
        cube[i * 3] - center[0],
        cube[i * 3 + 1] - center[1],
        cube[i * 3 + 2] - center[2],
      ),
    );
  let corner = 0;
  if (n)
    for (let i = 0; i < 8; i++)
      corner = Math.max(
        corner,
        Math.hypot(
          ...[0, 1, 2].map((k) => (i & (1 << k) ? max[k] : min[k]) - center[k]),
        ),
      );
  const radius = Math.max(MIN_RADIUS, farthest, corner / BOX_REACH);
  return { center, zoom: VIEW_RADIUS / radius };
}

/** A cube point in the view units `fit` describes. */
export function fitPoint(p: Vec3, { center, zoom }: ViewFit): Vec3 {
  return [
    (p[0] - center[0]) * zoom,
    (p[1] - center[1]) * zoom,
    (p[2] - center[2]) * zoom,
  ];
}

/**
 * The eight corners of a box given in 0-255 coordinates, fitted like the
 * points. Bit k of the index picks the high end of axis k.
 */
export function boxCorners(
  { min, max }: { min: Pixel; max: Pixel },
  fit: ViewFit,
): Vec3[] {
  return Array.from({ length: 8 }, (_, i) =>
    fitPoint(
      [0, 1, 2].map((k) => (i & (1 << k) ? max[k] : min[k]) - 127.5) as Vec3,
      fit,
    ),
  );
}

export const TILT = Math.PI / 9;

/**
 * Pixels per view unit: the fitted radius spans 42% of the shorter side,
 * less where that would cross the margin.
 */
export function viewScale(width: number, height: number): number {
  const side = Math.min(width, height);
  return (
    Math.max(0, Math.min(FIT_SHARE * side, side / 2 - FRAME_MARGIN)) /
    VIEW_RADIUS
  );
}

/** Yaw by `angle`, tilt toward the viewer, and scale view units to the frame. */
export function project(
  p: Vec3,
  angle: number,
  width: number,
  height: number,
): [number, number] {
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  const rotatedX = p[0] * cosY + p[2] * sinY;
  const rotatedZ = -p[0] * sinY + p[2] * cosY;
  const rotatedY = p[1] * Math.cos(TILT) - rotatedZ * Math.sin(TILT);
  const scale = viewScale(width, height);
  return [width / 2 + rotatedX * scale, height / 2 - rotatedY * scale];
}

/**
 * 0..n-1 in bit-reversed order, skipping values past n. Any prefix of the
 * result is spread evenly over the whole range, so drawing fewer points
 * still covers the whole image.
 */
export function bitReversalOrder(n: number): Uint32Array {
  const order = new Uint32Array(n);
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(n, 2))));
  let k = 0;
  for (let i = 0; k < n; i++) {
    let reversed = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1)
      reversed = (reversed << 1) | (x & 1);
    if (reversed < n) order[k++] = reversed;
  }
  return order;
}

/** Mean cube position and sample count of each group. */
export function groupCentroids(
  cube: Float32Array,
  groups: Uint8Array,
  groupCount: number,
): { centroids: (Vec3 | null)[]; counts: number[] } {
  const sums = new Float64Array(groupCount * 3);
  const counts = new Array<number>(groupCount).fill(0);
  groups.forEach((g, i) => {
    if (g >= groupCount) return;
    counts[g]++;
    sums[3 * g] += cube[3 * i];
    sums[3 * g + 1] += cube[3 * i + 1];
    sums[3 * g + 2] += cube[3 * i + 2];
  });
  const centroids = counts.map((count, g): Vec3 | null =>
    count
      ? [sums[3 * g] / count, sums[3 * g + 1] / count, sums[3 * g + 2] / count]
      : null,
  );
  return { centroids, counts };
}

/**
 * Where each swatch's flyer starts: the count-weighted mean of the centroids
 * of every group shown by that swatch, or null when no group is.
 */
export function flyerOrigins(
  centroids: (Vec3 | null)[],
  counts: number[],
  swatchOfGroup: Uint8Array,
  swatchCount: number,
): (Vec3 | null)[] {
  const sums = new Float64Array(swatchCount * 3);
  const weights = new Array<number>(swatchCount).fill(0);
  centroids.forEach((c, g) => {
    const s = swatchOfGroup[g];
    if (!c || s === NO_SWATCH || s >= swatchCount || !counts[g]) return;
    weights[s] += counts[g];
    sums[3 * s] += c[0] * counts[g];
    sums[3 * s + 1] += c[1] * counts[g];
    sums[3 * s + 2] += c[2] * counts[g];
  });
  return weights.map((w, s): Vec3 | null =>
    w ? [sums[3 * s] / w, sums[3 * s + 1] / w, sums[3 * s + 2] / w] : null,
  );
}
