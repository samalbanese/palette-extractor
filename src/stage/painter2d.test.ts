import { expect, it } from "vitest";
import type { StageSamples } from "../lib/extraction";
import { coverTransform, imagePoint, project, type Vec3 } from "./math";
import { prepare, type DrawState } from "./data";
import { create } from "./painter2d";

/** A 2D context that records every call and style that reaches a fill. */
function recorder() {
  const calls: unknown[][] = [];
  const ctx = {
    fillStyle: "",
    globalAlpha: 1,
    clearRect: (...a: number[]) => calls.push(["clearRect", ...a]),
    setTransform: (...a: number[]) => calls.push(["setTransform", ...a]),
    beginPath: () => {},
    arc: (...a: number[]) => calls.push(["arc", ...a]),
    fill: () => calls.push(["fill", ctx.fillStyle, ctx.globalAlpha]),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { calls, ctx, canvas: canvas as unknown as HTMLCanvasElement };
}

/** The painter as it drew before its per-frame work was cached. */
function reference(
  ctx: ReturnType<typeof recorder>["ctx"],
  samples: StageSamples,
  state: DrawState,
  width: number,
  height: number,
) {
  const { cube, order, centroids } = prepare(samples, "oklab");
  const cover = coverTransform(samples.width, samples.height, width, height);
  ctx.clearRect(0, 0, width, height);
  const pull = state.converge * (1 - state.release);
  ctx.globalAlpha =
    (1 - 0.4 * state.release) * (1 - 0.75 * state.flight * (1 - state.release));
  const pitch =
    cover.scale *
    Math.sqrt((samples.width * samples.height) / Math.min(4000, order.length));
  const radius = (pitch * 1.35 * (1 - state.toCloud) + 2.5 * state.toCloud) / 2;
  for (let j = 0; j < Math.min(4000, order.length); j++) {
    const i = order[j],
      g = samples.groups[i],
      center = centroids[g]!;
    const point = cube
      .subarray(i * 3, i * 3 + 3)
      .map((v, k) => v + (center[k] - v) * pull);
    const cloud = project(
      Array.from(point) as Vec3,
      state.angle,
      width,
      height,
    );
    const frame = imagePoint(
      samples.positions[i * 2],
      samples.positions[i * 2 + 1],
      cover,
    );
    const color = samples.groupColors[g];
    const rgb = [color.r, color.g, color.b].map((v, k) =>
      Math.round(samples.colors[i * 3 + k] * (1 - pull) + v * pull),
    );
    ctx.fillStyle = `rgb(${rgb.join(" ")})`;
    ctx.beginPath();
    ctx.arc(
      frame[0] + (cloud[0] - frame[0]) * state.toCloud,
      frame[1] + (cloud[1] - frame[1]) * state.toCloud,
      radius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

it("draws exactly what it drew before, frame after frame", async () => {
  // Deterministic pseudo-random samples over a 97 x 61 working image.
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const n = 5000;
  const samples: StageSamples = {
    width: 97,
    height: 61,
    positions: Uint16Array.from({ length: n * 2 }, (_, k) =>
      Math.floor(next() * (k % 2 ? 61 : 97)),
    ),
    colors: Uint8Array.from({ length: n * 3 }, () => Math.floor(next() * 256)),
    groups: Uint8Array.from({ length: n }, () => Math.floor(next() * 5)),
    boxes: new Uint8Array(0),
    groupColors: Array.from({ length: 5 }, (_, g) => ({
      r: 40 * g,
      g: 255 - 30 * g,
      b: 90 + g,
    })),
  };
  const painter = recorder();
  const renderer = create(painter.canvas);
  renderer.resize(380, 245, 2);
  await renderer.setSamples(samples, "oklab");
  const states: DrawState[] = [
    [0, 0, 0, 0, 0.2],
    [0.6, 0, 0, 0, 0.9],
    [1, 0.55, 0, 0, 1.4],
    [1, 1, 0.5, 0, 2.1],
    [1, 1, 1, 0.35, 2.7],
    [1, 1, 1, 1, 3.3],
  ].map(([toCloud, converge, flight, release, angle]) => ({
    phase: "split",
    split: 0,
    done: false,
    toCloud,
    converge,
    flight,
    release,
    angle,
    points: 4000,
  }));
  for (const state of states) {
    painter.calls.length = 0;
    renderer.draw(state);
    const expected = recorder();
    reference(expected.ctx, samples, state, 380, 245);
    expect(painter.calls).toEqual(expected.calls);
  }
});
