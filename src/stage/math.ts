import {
  oklabCoords,
  type ColorSpace,
  type Pixel,
} from "@samalbanese/median-cut";
import { NO_SWATCH } from "../lib/stageGroups";

/**
 * A point in the color cube, centered on 0 (each axis -127.5..127.5), or the
 * same point relative to a fit's center once fitted.
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

export const TILT = Math.PI / 9;
const TILT_COS = Math.cos(TILT);
const TILT_SIN = Math.sin(TILT);

/**
 * How a sample set sits in the frame. The view turns about `center`, the
 * mean of the points. `reachX` and `reachY` are the farthest any point gets
 * from it across and up the screen at any yaw, in cube units; `boxX` and
 * `boxY` are the same for the corners of the box around every point, where
 * the split boxes start.
 */
export interface ViewFit {
  center: Vec3;
  reachX: number;
  reachY: number;
  boxX: number;
  boxY: number;
}

/** CSS pixels kept clear between the points and the frame edge. */
export const FRAME_MARGIN = 22;
/** Box outlines may run into the margin, but stay this far inside the edge. */
const BOX_INSET = 2;
/**
 * The smallest reach a fit uses, in cube units, so a near-flat image shows
 * as a small cluster instead of magnified noise.
 */
const MIN_REACH = 12;

/**
 * Only yaw turns the view; the tilt is fixed. Over every yaw, a point at
 * (dx, dy, dz) from the center, with h = hypot(dx, dz), lands at most h from
 * the center across the screen and at most |dy| cos(tilt) + h sin(tilt) up
 * or down it. Both bounds are reached at some yaw, so they are exact.
 */
function reach(dx: number, dy: number, dz: number): [number, number] {
  const h = Math.hypot(dx, dz);
  return [h, Math.abs(dy) * TILT_COS + h * TILT_SIN];
}

/**
 * The fit of a cloud: its mean, and how far its points and its bounding box
 * can reach on screen at any yaw. The farthest point, rather than a
 * percentile, sets the reach, so no point ever leaves the frame.
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
  let reachX = MIN_REACH,
    reachY = MIN_REACH;
  for (let i = 0; i < n; i++) {
    const [x, y] = reach(
      cube[i * 3] - center[0],
      cube[i * 3 + 1] - center[1],
      cube[i * 3 + 2] - center[2],
    );
    reachX = Math.max(reachX, x);
    reachY = Math.max(reachY, y);
  }
  let boxX = reachX,
    boxY = reachY;
  if (n)
    for (let i = 0; i < 8; i++) {
      const [x, y] = reach(
        ...([0, 1, 2].map(
          (k) => (i & (1 << k) ? max[k] : min[k]) - center[k],
        ) as Vec3),
      );
      boxX = Math.max(boxX, x);
      boxY = Math.max(boxY, y);
    }
  return { center, reachX, reachY, boxX, boxY };
}

/** A cube point relative to the fit's center, which the view turns about. */
export function fitPoint(p: Vec3, { center }: ViewFit): Vec3 {
  return [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
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

/**
 * Pixels per cube unit: as large as the frame allows with every point
 * inside the margin and every box corner inside the edge, at any yaw.
 * Whichever axis is tighter sets the scale. The WebGL renderer, the 2D
 * painter and the overlays all take their scale from here.
 */
export function viewScale(width: number, height: number, fit: ViewFit) {
  return Math.max(
    0,
    Math.min(
      (width / 2 - FRAME_MARGIN) / fit.reachX,
      (height / 2 - FRAME_MARGIN) / fit.reachY,
      (width / 2 - BOX_INSET) / fit.boxX,
      (height / 2 - BOX_INSET) / fit.boxY,
    ),
  );
}

/**
 * Yaw a fitted point by `angle` about the fit's center, tilt it toward the
 * viewer, and scale it to the frame.
 */
export function project(
  p: Vec3,
  angle: number,
  width: number,
  height: number,
  fit: ViewFit,
): [number, number] {
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  const rotatedX = p[0] * cosY + p[2] * sinY;
  const rotatedZ = -p[0] * sinY + p[2] * cosY;
  const rotatedY = p[1] * TILT_COS - rotatedZ * TILT_SIN;
  const scale = viewScale(width, height, fit);
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
