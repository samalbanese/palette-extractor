import { describe, expect, it } from "vitest";
import type { SplitStep } from "@samalbanese/median-cut";
import { PINNED_BOX, type StageSamples } from "../lib/extraction";
import { project } from "./math";
import { cloudAtRest, finalMarkers, stepEdges, traceSamples } from "./trace";

/** Four samples over two steps; the third was held out for a locked color. */
const samples = (boxes: number[]): StageSamples => ({
  width: 4,
  height: 1,
  positions: new Uint16Array([0, 0, 1, 0, 2, 0, 3, 0]),
  colors: new Uint8Array([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]),
  groups: new Uint8Array([0, 1, 2, 1]),
  boxes: new Uint8Array(boxes),
  groupColors: [
    { r: 10, g: 0, b: 0 },
    { r: 30, g: 0, b: 0 },
    { r: 99, g: 0, b: 0 },
  ],
});

describe("traceSamples", () => {
  it("drops samples held out for a locked color, keeping order and boxes", () => {
    const traced = traceSamples(
      samples([0, 0, PINNED_BOX, 0, 0, 1, PINNED_BOX, 1]),
    );
    expect([...traced.positions]).toEqual([0, 0, 1, 0, 3, 0]);
    expect([...traced.colors]).toEqual([10, 0, 0, 20, 0, 0, 40, 0, 0]);
    expect([...traced.groups]).toEqual([0, 1, 1]);
    // Step 0 for the three kept samples, then step 1.
    expect([...traced.boxes]).toEqual([0, 0, 0, 0, 1, 1]);
    expect(traced.groupColors).toHaveLength(3);
  });

  it("keeps every sample when nothing is locked", () => {
    expect(traceSamples(samples([0, 0, 0, 0])).groups).toHaveLength(4);
  });

  it("returns nothing for a result with no steps", () => {
    const traced = traceSamples(samples([]));
    expect(traced.groups).toHaveLength(0);
    expect(traced.positions).toHaveLength(0);
    expect(traced.colors).toHaveLength(0);
  });

  it("returns nothing when every sample is held out", () => {
    expect(
      traceSamples(samples([PINNED_BOX, PINNED_BOX, PINNED_BOX, PINNED_BOX]))
        .groups,
    ).toHaveLength(0);
  });
});

it("draws the cloud at rest: on the cube, in its own colors", () => {
  expect(cloudAtRest({ stepIndex: 3, angle: 1.5, points: 42 })).toMatchObject({
    toCloud: 1,
    converge: 0,
    release: 1,
    flight: 0,
    angle: 1.5,
    points: 42,
  });
});

const box = (
  min: [number, number, number],
  max: [number, number, number],
  color = { r: 0, g: 0, b: 0 },
  population = 1,
) => ({ bounds: { min, max }, color, population });

describe("stepEdges", () => {
  it("projects the twelve edges of each box from its corners", () => {
    const step: SplitStep = [box([0, 10, 20], [100, 110, 120])];
    const edges = stepEdges(step, 0.7, 400, 300);
    expect(edges).toHaveLength(12);
    const corner = (x: number, y: number, z: number) =>
      project([x - 127.5, y - 127.5, z - 127.5], 0.7, 400, 300);
    // The edge along the first axis from the lowest corner.
    expect(edges).toContainEqual([
      ...corner(0, 10, 20),
      ...corner(100, 10, 20),
    ]);
    // The edge along the third axis into the highest corner.
    expect(edges).toContainEqual([
      ...corner(100, 110, 20),
      ...corner(100, 110, 120),
    ]);
  });

  it("covers every box of the step", () => {
    const step: SplitStep = [
      box([0, 0, 0], [50, 50, 50]),
      box([60, 0, 0], [255, 50, 50]),
    ];
    expect(stepEdges(step, 0, 400, 300)).toHaveLength(24);
  });
});

describe("finalMarkers", () => {
  it("sizes each marker by its share and places it at its color", () => {
    const red = { r: 255, g: 0, b: 0 };
    const step: SplitStep = [
      box([255, 0, 0], [255, 0, 0], red, 3),
      box([0, 0, 255], [0, 0, 255], { r: 0, g: 0, b: 255 }, 1),
    ];
    const [first, second] = finalMarkers(step, "rgb", 0.3, 400, 300);
    expect(first.radius).toBeCloseTo(4.5 + 7 * Math.sqrt(0.75), 10);
    expect(second.radius).toBeCloseTo(4.5 + 7 * Math.sqrt(0.25), 10);
    const [x, y] = project([127.5, -127.5, -127.5], 0.3, 400, 300);
    expect(first).toMatchObject({ x, y, color: red });
  });
});
