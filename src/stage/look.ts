import { TILT } from "./math";
import type { IntroState } from "./timeline";

/**
 * How each point of the cloud looks. The 2D painter calls these directly;
 * the WebGL shader repeats the same formulas, and the painter tests pin them.
 */

const TILT_COS = Math.cos(TILT);
const TILT_SIN = Math.sin(TILT);

/** How much the whole cloud softens once it rests. */
export const REST_FADE = 0.1;
/** Farthest points keep this share of their opacity less. */
export const DEPTH_FADE = 0.45;
/** Nearest points grow, and farthest shrink, by this share. */
export const DEPTH_GROW = 0.3;
/** Points outside the focused swatch's groups keep this share less. */
export const FOCUS_FADE = 0.97;
/** Points inside the focused swatch's groups grow by this share. */
export const FOCUS_GROW = 0.35;
/** Points outside them shrink by this share, so dense ones stop stacking. */
export const FOCUS_SHRINK = 0.5;

/**
 * How far each point has taken its group's color. Points never move toward
 * their group: the cloud keeps its shape while the palette shows through.
 */
export const tint = ({ converge, release }: IntroState) =>
  converge * (1 - release);

/** The whole cloud's opacity: full while it forms, a little softer at rest. */
export const cloudAlpha = ({ release }: IntroState) => 1 - REST_FADE * release;

/** A resting point's diameter in CSS pixels, larger in a larger frame. */
export const restSize = (width: number, height: number) =>
  Math.min(4.2, Math.max(2.6, Math.min(width, height) / 110));

/** The distance from the center that counts as fully near or far. */
export const depthReach = (fit: { reachX: number; reachY: number }) =>
  Math.max(1, fit.reachX, fit.reachY);

/**
 * How near a fitted point (x, y, z) sits to the viewer at the yaw whose
 * cosine and sine are given, from -1 (back) to 1 (front), using the same
 * yaw and tilt as `project`.
 */
export function nearness(
  x: number,
  y: number,
  z: number,
  cos: number,
  sin: number,
  reach: number,
) {
  const turned = -x * sin + z * cos;
  const near = (y * TILT_SIN + turned * TILT_COS) / reach;
  return Math.max(-1, Math.min(1, near));
}

/** Size and opacity factors for depth; none while the photo still shows. */
export const depthSize = (near: number, toCloud: number) =>
  1 + DEPTH_GROW * near * toCloud;
export const depthAlpha = (near: number, toCloud: number) =>
  1 - (DEPTH_FADE * (1 - near) * toCloud) / 2;

/** Size and opacity factors for a point while a swatch is in focus. */
export const focusSize = (lit: number, focus: number) =>
  1 + (FOCUS_GROW * lit - FOCUS_SHRINK * (1 - lit)) * focus;
export const focusAlpha = (lit: number, focus: number) =>
  1 - FOCUS_FADE * (1 - lit) * focus;
