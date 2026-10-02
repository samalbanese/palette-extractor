import {
  oklabCoords,
  type ColorSpace,
  type Pixel,
} from "@samalbanese/median-cut";
import { NO_SWATCH } from "../lib/stageGroups";

/** A point in the color cube, centered on 0 (each axis -127.5..127.5). */
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
 * A color's position in the cube for the given space. This is the only place
 * coordinates are centered; `project` takes them as they come.
 */
export function colorPoint(rgb: Pixel, colorSpace: ColorSpace): Vec3 {
  const c = colorSpace === "oklab" ? oklabCoords(rgb) : rgb;
  return [c[0] - 127.5, c[1] - 127.5, c[2] - 127.5];
}

export const TILT = Math.PI / 9;

/** Yaw by `angle`, tilt toward the viewer, and fit the cube to the frame. */
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
  const scale = (Math.min(width, height) - 44) / 360;
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
