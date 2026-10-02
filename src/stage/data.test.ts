import { expect, it } from "vitest";
import type { StageSamples } from "../lib/extraction";
import { prepare } from "./data";
import { colorPoint, fitPoint, fitView, type Vec3 } from "./math";

const samples: StageSamples = {
  width: 3,
  height: 1,
  positions: new Uint16Array([0, 0, 1, 0, 2, 0]),
  colors: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0]),
  groups: new Uint8Array([0, 0, 1]),
  boxes: new Uint8Array(),
  groupColors: [
    { r: 128, g: 128, b: 128 },
    { r: 255, g: 0, b: 0 },
  ],
};

function expectNear(actual: ArrayLike<number> | null, expected: Vec3) {
  expect(actual).not.toBeNull();
  expected.forEach((v, k) => expect(actual![k]).toBeCloseTo(v, 4));
}

it("keeps original sample indices for centroids and a separate upload order", () => {
  const data = prepare(samples, "rgb");
  // Group 0 averages black and white, the middle of the cube.
  expectNear(data.centroids[0], fitPoint([0, 0, 0], data.fit));
  expectNear(data.centroids[1], fitPoint([127.5, -127.5, -127.5], data.fit));
  expect(data.counts).toEqual([2, 1]);
  expect([...data.order]).toEqual([0, 2, 1]);
});

it("holds every point, and so every centroid, in fitted coordinates", () => {
  const data = prepare(samples, "rgb");
  const raw = new Float32Array(9);
  for (let i = 0; i < 3; i++)
    raw.set(
      colorPoint(
        [
          samples.colors[i * 3],
          samples.colors[i * 3 + 1],
          samples.colors[i * 3 + 2],
        ],
        "rgb",
      ),
      i * 3,
    );
  expect(data.fit).toEqual(fitView(raw));
  for (let i = 0; i < 3; i++)
    expectNear(
      data.cube.subarray(i * 3, i * 3 + 3),
      fitPoint([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]], data.fit),
    );
  // The fitted cloud is centered on its mean.
  for (let k = 0; k < 3; k++)
    expect(data.cube[k] + data.cube[3 + k] + data.cube[6 + k]).toBeCloseTo(
      0,
      3,
    );
});

it("uses a fit it is given, so a subset lines up with the whole set", () => {
  const fit = {
    center: [10, 20, 30] as Vec3,
    reachX: 100,
    reachY: 80,
    boxX: 110,
    boxY: 90,
  };
  const data = prepare(samples, "rgb", fit);
  expect(data.fit).toBe(fit);
  expectNear(data.cube.subarray(0, 3), [-137.5, -147.5, -157.5]);
});
