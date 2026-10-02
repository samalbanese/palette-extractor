import type { ColorSpace, SplitStep } from "@samalbanese/median-cut";
import { PINNED_BOX, type StageSamples } from "../lib/extraction";
import { colorPoint, project, type Vec3 } from "./math";
import type { DrawState } from "./data";

/** Points the 2D painter draws, the same figure the stage falls back to. */
export const FALLBACK_POINTS = 4000;

/** What the split trace shows: which step, from which angle, how many points. */
export interface TraceState {
  stepIndex: number;
  angle: number;
  points: number;
}

/**
 * The samples that took part in the splits, in their original order. Samples
 * held out for a locked color never entered a box; a result with no steps
 * has nothing to trace.
 */
export function traceSamples(samples: StageSamples): StageSamples {
  const n = samples.groups.length;
  const stepCount = n ? samples.boxes.length / n : 0;
  const kept: number[] = [];
  if (stepCount)
    for (let i = 0; i < n; i++)
      if (samples.boxes[i] !== PINNED_BOX) kept.push(i);
  const m = kept.length;
  const positions = new Uint16Array(m * 2);
  const colors = new Uint8Array(m * 3);
  const groups = new Uint8Array(m);
  const boxes = new Uint8Array(m * stepCount);
  kept.forEach((i, j) => {
    positions.set(samples.positions.subarray(i * 2, i * 2 + 2), j * 2);
    colors.set(samples.colors.subarray(i * 3, i * 3 + 3), j * 3);
    groups[j] = samples.groups[i];
    for (let k = 0; k < stepCount; k++)
      boxes[k * m + j] = samples.boxes[k * n + i];
  });
  return { ...samples, positions, colors, groups, boxes };
}

/**
 * The renderer state for a trace frame: the stage's cloud at rest, every
 * point at its own cube position in its own color.
 */
export function cloudAtRest({ angle, points }: TraceState): DrawState {
  return {
    phase: "done",
    toCloud: 1,
    split: 1,
    converge: 0,
    flight: 0,
    release: 1,
    done: true,
    angle,
    points,
  };
}

/** Screen-space edges of every box in a step, as [x1, y1, x2, y2]. */
export function stepEdges(
  step: SplitStep,
  angle: number,
  width: number,
  height: number,
): [number, number, number, number][] {
  const edges: [number, number, number, number][] = [];
  for (const { bounds } of step) {
    const corners = Array.from({ length: 8 }, (_, i) =>
      project(
        [0, 1, 2].map(
          (k) => (i & (1 << k) ? bounds.max[k] : bounds.min[k]) - 127.5,
        ) as Vec3,
        angle,
        width,
        height,
      ),
    );
    corners.forEach((p, i) => {
      for (let k = 0; k < 3; k++)
        if (!(i & (1 << k))) edges.push([...p, ...corners[i | (1 << k)]]);
    });
  }
  return edges;
}

/** Where each final color's marker sits, and how large it is. */
export function finalMarkers(
  step: SplitStep,
  space: ColorSpace,
  angle: number,
  width: number,
  height: number,
) {
  const total = step.reduce((sum, box) => sum + box.population, 0);
  return step.map(({ color, population }) => {
    const [x, y] = project(
      colorPoint([color.r, color.g, color.b], space),
      angle,
      width,
      height,
    );
    // Marker size tracks how much of the image the color covers.
    const radius = 4.5 + 7 * Math.sqrt(total ? population / total : 0);
    return { x, y, radius, color };
  });
}

/**
 * Draws the boxes of the selected step over the points, and at the final
 * step one marker per final color. Earlier steps are not drawn.
 */
export function drawTrace(
  canvas: HTMLCanvasElement,
  steps: SplitStep[],
  space: ColorSpace,
  state: TraceState,
  width: number,
  height: number,
  dpr: number,
) {
  const ctx = canvas.getContext("2d")!;
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const step = steps[state.stepIndex];
  if (!step) return;
  ctx.strokeStyle = "rgba(218, 226, 231, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of stepEdges(step, state.angle, width, height)) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  if (state.stepIndex !== steps.length - 1) return;
  ctx.strokeStyle = "#e5dfd2";
  ctx.lineWidth = 1.5;
  for (const { x, y, radius, color } of finalMarkers(
    step,
    space,
    state.angle,
    width,
    height,
  )) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${color.r} ${color.g} ${color.b})`;
    ctx.fill();
    ctx.stroke();
  }
}
