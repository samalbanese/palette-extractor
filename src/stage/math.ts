import {
  oklabCoords,
  type ColorSpace,
  type Pixel,
} from "@relaywright/median-cut";
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
 * middle of the points' range on each axis. `reachX` and `reachY` are the
 * farthest any point gets from it across and up the screen at any yaw, in
 * cube units; `boxX` and `boxY` are the same for the corners of the box
 * around every point, where the split boxes start.
 */
export interface ViewFit {
  center: Vec3;
  reachX: number;
  reachY: number;
  boxX: number;
  boxY: number;
  /**
   * The same four reaches for each slice of the turn, so the view can zoom
   * in at yaws where the cloud looks small. A fit without them keeps one
   * size at every yaw.
   */
  turn?: TurnReach;
}

/**
 * Entry k covers yaws from k to k + 1 times `TURN_SLICE`, and holds the
 * farthest anything reaches at any yaw in that slice.
 */
export interface TurnReach {
  reachX: Float64Array;
  reachY: Float64Array;
  boxX: Float64Array;
  boxY: Float64Array;
}

/** How many slices a turn is measured in. */
const TURN_SLICES = 64;
const TURN_SLICE = (2 * Math.PI) / TURN_SLICES;
const SLICE_COS = Array.from({ length: TURN_SLICES }, (_, k) =>
  Math.cos(k * TURN_SLICE),
);
const SLICE_SIN = Array.from({ length: TURN_SLICES }, (_, k) =>
  Math.sin(k * TURN_SLICE),
);
/** The most a turn may enlarge the view over the size that fits every yaw. */
const MAX_ZOOM = 2.5;
/**
 * The fastest the zoom changes as the view turns, in log scale per radian:
 * about 2% a degree, so it eases in and out instead of pumping.
 */
const ZOOM_RATE = 1.2;
/** Slices the zoom holds still on either side of a tight one. */
const ZOOM_HOLD = 2;

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
 * Each point's farthest reach across and up the screen at every slice's
 * starting yaw, and the most any point's height adds to the reach up it.
 */
function sweep(cube: Float32Array, center: Vec3) {
  const across = new Float64Array(TURN_SLICES);
  const up = new Float64Array(TURN_SLICES);
  let lift = 0;
  for (let i = 0; i < cube.length; i += 3) {
    const dx = cube[i] - center[0];
    const dy = (cube[i + 1] - center[1]) * TILT_COS;
    const dz = cube[i + 2] - center[2];
    lift = Math.max(lift, Math.abs(dy));
    for (let k = 0; k < TURN_SLICES; k++) {
      const c = SLICE_COS[k],
        s = SLICE_SIN[k];
      const x = Math.abs(dx * c + dz * s);
      const y = Math.abs(dy + (dx * s - dz * c) * TILT_SIN);
      if (x > across[k]) across[k] = x;
      if (y > up[k]) up[k] = y;
    }
  }
  return { across, up, lift };
}

/**
 * The farthest reach anywhere in each slice, from the reaches at its two
 * ends. A point's reach is |lift + w . u| for a unit vector u turning with
 * the yaw; within a slice u is a mix of the two end vectors whose weights
 * sum to at most 1 / cos(half a slice), which bounds how far past the ends
 * it can get. Never past `limit`, the bound over every yaw, nor under the
 * smallest reach a fit uses.
 */
function slices(ends: Float64Array, lift: number, limit: number) {
  const spread = 1 / Math.cos(TURN_SLICE / 2);
  return ends.map((reach, k) =>
    Math.max(
      MIN_REACH,
      Math.min(
        limit,
        (Math.max(reach, ends[(k + 1) % TURN_SLICES]) + lift) * spread - lift,
      ),
    ),
  );
}

/** A box in 0-255 coordinates, like the quantizer's split boxes. */
export interface Extent {
  min: Pixel;
  max: Pixel;
}

/**
 * The fit of a cloud: the middle of its range, and how far its points and
 * its bounding box can reach on screen at any yaw. Turning about the middle
 * rather than the mean keeps a lopsided cloud, most of whose pixels sit at
 * one end, from swinging its far end out to the frame. The farthest point,
 * rather than a percentile, sets the reach, so no point ever leaves the
 * frame. `extent` widens the bounding box to colors the samples skipped,
 * which the split boxes still reach.
 */
export function fitView(cube: Float32Array, extent?: Extent): ViewFit {
  const n = cube.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const v = cube[i * 3 + k];
      min[k] = Math.min(min[k], v);
      max[k] = Math.max(max[k], v);
    }
  const center: Vec3 = n
    ? ([0, 1, 2].map((k) => (min[k] + max[k]) / 2) as Vec3)
    : [0, 0, 0];
  if (n && extent)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], extent.min[k] - 127.5);
      max[k] = Math.max(max[k], extent.max[k] - 127.5);
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
  const corners = new Float32Array(n ? 24 : 0);
  for (let i = 0; i < corners.length / 3; i++) {
    const corner = [0, 1, 2].map((k) => (i & (1 << k) ? max[k] : min[k]));
    corners.set(corner, i * 3);
    const [x, y] = reach(...(corner.map((v, k) => v - center[k]) as Vec3));
    boxX = Math.max(boxX, x);
    boxY = Math.max(boxY, y);
  }
  const points = sweep(cube, center);
  const box = sweep(corners, center);
  const turn: TurnReach = {
    reachX: slices(points.across, 0, reachX),
    reachY: slices(points.up, points.lift, reachY),
    boxX: slices(box.across, 0, boxX),
    boxY: slices(box.up, box.lift, boxY),
  };
  for (let k = 0; k < TURN_SLICES; k++) {
    turn.boxX[k] = Math.max(turn.boxX[k], turn.reachX[k]);
    turn.boxY[k] = Math.max(turn.boxY[k], turn.reachY[k]);
  }
  return { center, reachX, reachY, boxX, boxY, turn };
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

/** The largest scale that keeps the given reaches inside the frame. */
function room(
  width: number,
  height: number,
  reachX: number,
  reachY: number,
  boxX: number,
  boxY: number,
) {
  return Math.min(
    (width / 2 - FRAME_MARGIN) / reachX,
    (height / 2 - FRAME_MARGIN) / reachY,
    (width / 2 - BOX_INSET) / boxX,
    (height / 2 - BOX_INSET) / boxY,
  );
}

// Per fit, the last frame size's tables, with and without room for boxes.
const zooms = new WeakMap<
  ViewFit,
  { width: number; height: number; tables: (Float64Array | undefined)[] }
>();

/**
 * The log of the scale at each slice's starting yaw for one frame size.
 * Each yaw takes the room left by the slices on either side of it, capped
 * at `MAX_ZOOM` times `still`. That is then lowered wherever it would rise
 * faster than `ZOOM_RATE` after a stretch held flat for `ZOOM_HOLD` slices
 * on each side, and averaged over that stretch: the average never passes
 * the room at any yaw, and keeps the zoom's rate within `ZOOM_RATE`.
 */
function zoomTable(
  width: number,
  height: number,
  fit: ViewFit,
  still: number,
  boxes: boolean,
) {
  let cached = zooms.get(fit);
  if (cached?.width !== width || cached.height !== height) {
    cached = { width, height, tables: [] };
    zooms.set(fit, cached);
  }
  const known = cached.tables[+boxes];
  if (known) return known;
  const turn = fit.turn!;
  const ceiling = Math.log(still * MAX_ZOOM);
  const limit = Array.from({ length: TURN_SLICES }, (_, k) => {
    const before = (k + TURN_SLICES - 1) % TURN_SLICES;
    const widest = (reach: Float64Array) => Math.max(reach[before], reach[k]);
    const x = widest(turn.reachX),
      y = widest(turn.reachY);
    return Math.min(
      ceiling,
      Math.log(
        boxes
          ? room(width, height, x, y, widest(turn.boxX), widest(turn.boxY))
          : room(width, height, x, y, x, y),
      ),
    );
  });
  const eased = limit.map((_, k) => {
    let lowest = Infinity;
    for (let j = 0; j < TURN_SLICES; j++) {
      const apart = Math.abs(j - k);
      const slices = Math.min(apart, TURN_SLICES - apart);
      lowest = Math.min(
        lowest,
        limit[j] + ZOOM_RATE * TURN_SLICE * Math.max(0, slices - ZOOM_HOLD),
      );
    }
    return lowest;
  });
  const log = new Float64Array(TURN_SLICES);
  for (let k = 0; k < TURN_SLICES; k++) {
    let sum = 0;
    for (let j = -ZOOM_HOLD; j <= ZOOM_HOLD; j++)
      sum += eased[(k + j + TURN_SLICES) % TURN_SLICES];
    log[k] = sum / (2 * ZOOM_HOLD + 1);
  }
  cached.tables[+boxes] = log;
  return log;
}

/**
 * Pixels per cube unit: as large as the frame allows with every point
 * inside the margin and, while `boxes` is 1, every corner of the box
 * around them inside the edge, where the split boxes start. Between 0 and
 * 1 it moves evenly, in log scale, from one to the other.
 *
 * Without an `angle` that holds at every yaw. With one, the view zooms in
 * where the cloud looks smaller from that yaw, easing between yaws, never
 * below the every-yaw size. The WebGL renderer, the 2D painter and the
 * overlays all take their scale from here.
 */
export function viewScale(
  width: number,
  height: number,
  fit: ViewFit,
  angle?: number,
  boxes = 1,
) {
  const scale = (withBoxes: boolean) => {
    const { reachX, reachY } = fit;
    const still = Math.max(
      0,
      withBoxes
        ? room(width, height, reachX, reachY, fit.boxX, fit.boxY)
        : room(width, height, reachX, reachY, reachX, reachY),
    );
    if (angle === undefined || !fit.turn || still === 0) return still;
    const log = zoomTable(width, height, fit, still, withBoxes);
    const at =
      (((angle / TURN_SLICE) % TURN_SLICES) + TURN_SLICES) % TURN_SLICES;
    const k = Math.floor(at) % TURN_SLICES;
    const f = at - Math.floor(at);
    return Math.exp(log[k] * (1 - f) + log[(k + 1) % TURN_SLICES] * f);
  };
  if (boxes >= 1) return scale(true);
  if (boxes <= 0) return scale(false);
  return scale(true) ** boxes * scale(false) ** (1 - boxes);
}

/**
 * Yaw a fitted point by `angle` about the fit's center, tilt it toward the
 * viewer, and scale it to the frame, keeping `boxes` room for split boxes.
 */
export function project(
  p: Vec3,
  angle: number,
  width: number,
  height: number,
  fit: ViewFit,
  boxes = 1,
): [number, number] {
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  const rotatedX = p[0] * cosY + p[2] * sinY;
  const rotatedZ = -p[0] * sinY + p[2] * cosY;
  const rotatedY = p[1] * TILT_COS - rotatedZ * TILT_SIN;
  const scale = viewScale(width, height, fit, angle, boxes);
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
