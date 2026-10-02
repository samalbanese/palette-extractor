import { expect, it } from "vitest";
import type { SplitStep } from "@samalbanese/median-cut";
import type { StageSamples } from "../lib/extraction";
import { prepare, type DrawState } from "./data";
import { project, type Vec3 } from "./math";
import { drawOverlay } from "./overlay";

/** A canvas whose 2D context keeps every point a path visits. */
function recorder() {
  const visits: [number, number][] = [];
  const ctx = {
    strokeStyle: "",
    lineWidth: 1,
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    stroke: () => {},
    moveTo: (x: number, y: number) => visits.push([x, y]),
    lineTo: (x: number, y: number) => visits.push([x, y]),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { visits, canvas: canvas as unknown as HTMLCanvasElement };
}

const samples: StageSamples = {
  width: 3,
  height: 1,
  positions: new Uint16Array([0, 0, 1, 0, 2, 0]),
  colors: new Uint8Array([200, 40, 10, 30, 160, 220, 90, 90, 90]),
  groups: new Uint8Array([0, 1, 1]),
  boxes: new Uint8Array(),
  groupColors: [
    { r: 200, g: 40, b: 10 },
    { r: 60, g: 125, b: 155 },
  ],
};

const state: DrawState = {
  phase: "split",
  toCloud: 1,
  split: 0,
  converge: 0,
  flight: 0,
  release: 0,
  done: false,
  angle: 0.9,
  points: 3,
};

it("draws box corners where the points of those colors are drawn", () => {
  const data = prepare(samples, "rgb");
  // The box spans exactly from the second sample's color to the first's on
  // each axis, so two of its corners are those samples.
  const step: SplitStep = [
    {
      bounds: { min: [30, 40, 10], max: [200, 160, 220] },
      color: { r: 0, g: 0, b: 0 },
      population: 3,
    },
  ];
  const { visits, canvas } = recorder();
  drawOverlay(canvas, [step], state, data.fit, 640, 360, 1);
  for (const corner of [
    [200, 40, 10],
    [30, 160, 220],
  ]) {
    const i = samples.colors.findIndex(
      (_, j) =>
        j % 3 === 0 && corner.every((v, k) => samples.colors[j + k] === v),
    );
    const point = Array.from(data.cube.subarray(i, i + 3)) as Vec3;
    const [x, y] = project(point, state.angle, 640, 360);
    expect(
      visits.some(([vx, vy]) => Math.hypot(vx - x, vy - y) < 1e-3),
      `corner ${corner}`,
    ).toBe(true);
  }
});
