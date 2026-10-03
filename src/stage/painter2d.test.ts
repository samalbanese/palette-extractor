import { expect, it } from "vitest";
import type { StageSamples } from "../lib/extraction";
import { coverTransform, imagePoint, project, TILT, type Vec3 } from "./math";
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

/**
 * The cloud as the painter should draw it, written plainly: no cached
 * positions or styles, each point projected on its own.
 */
function reference(
  ctx: ReturnType<typeof recorder>["ctx"],
  samples: StageSamples,
  state: DrawState,
  width: number,
  height: number,
) {
  const { cube, fit, order } = prepare(samples, "oklab");
  const cover = coverTransform(samples.width, samples.height, width, height);
  ctx.clearRect(0, 0, width, height);
  const pull = state.converge * (1 - state.release);
  const focus = state.focus ?? 0;
  const pitch =
    cover.scale *
    Math.sqrt((samples.width * samples.height) / Math.min(4000, order.length));
  const diameter =
    pitch * 1.35 * (1 - state.toCloud) +
    Math.min(4.2, Math.max(2.6, Math.min(width, height) / 110)) * state.toCloud;
  const reach = Math.max(1, fit.reachX, fit.reachY);
  for (let j = 0; j < Math.min(4000, order.length); j++) {
    const i = order[j],
      g = samples.groups[i];
    const point = Array.from(cube.subarray(i * 3, i * 3 + 3)) as Vec3;
    const cloud = project(point, state.angle, width, height, fit, state.boxes);
    const frame = imagePoint(
      samples.positions[i * 2],
      samples.positions[i * 2 + 1],
      cover,
    );
    // Toward the viewer is +z once yawed, then tilted.
    const turned =
      -point[0] * Math.sin(state.angle) + point[2] * Math.cos(state.angle);
    const near = Math.max(
      -1,
      Math.min(
        1,
        (point[1] * Math.sin(TILT) + turned * Math.cos(TILT)) / reach,
      ),
    );
    const lit = state.lit?.[g] ?? 0;
    ctx.globalAlpha =
      (1 - 0.1 * state.release) *
      (1 - (0.45 * (1 - near) * state.toCloud) / 2) *
      (1 - 0.95 * (1 - lit) * focus);
    const radius =
      (diameter *
        (1 + 0.3 * near * state.toCloud) *
        (1 + (0.35 * lit - 0.5 * (1 - lit)) * focus)) /
      2;
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
    // Room for boxes eases away as the chips leave and the points spread.
    boxes: 1 - (flight + release) / 2,
  }));
  // A swatch in focus, part way and fully, then focus with no group lit.
  const lit = new Float32Array(32);
  lit[1] = lit[3] = 1;
  const rest = states[states.length - 1];
  states.push(
    { ...rest, focus: 0.4, lit },
    { ...rest, angle: 4.1, focus: 1, lit },
    { ...rest, focus: 1 },
  );
  for (const state of states) {
    painter.calls.length = 0;
    renderer.draw(state);
    const expected = recorder();
    reference(expected.ctx, samples, state, 380, 245);
    expect(painter.calls).toEqual(expected.calls);
  }
});

it("a focused swatch's groups stand out without moving any point", async () => {
  const samples: StageSamples = {
    width: 2,
    height: 1,
    positions: Uint16Array.from([0, 0, 1, 0]),
    colors: Uint8Array.from([200, 120, 40, 60, 140, 190]),
    groups: Uint8Array.from([0, 1]),
    boxes: new Uint8Array(0),
    groupColors: [
      { r: 200, g: 120, b: 40 },
      { r: 60, g: 140, b: 190 },
    ],
  };
  const painter = recorder();
  const renderer = create(painter.canvas);
  renderer.resize(300, 200, 1);
  await renderer.setSamples(samples, "rgb");
  const draw = (focus: number) => {
    const lit = new Float32Array(32);
    lit[1] = 1;
    painter.calls.length = 0;
    renderer.draw({
      phase: "done",
      toCloud: 1,
      split: 1,
      converge: 1,
      flight: 1,
      release: 1,
      done: true,
      angle: 0.5,
      points: 4000,
      boxes: 0,
      focus,
      lit,
    });
    const arcs = painter.calls.filter((c) => c[0] === "arc");
    const fills = painter.calls.filter((c) => c[0] === "fill");
    // Points are drawn in bit-reversed order: group 0, then group 1.
    return { arcs, alphas: fills.map((c) => c[2] as number) };
  };
  const calm = draw(0);
  const focused = draw(1);
  // Same places, the lit point larger, the other one faded.
  expect(focused.arcs.map((a) => a.slice(1, 3))).toEqual(
    calm.arcs.map((a) => a.slice(1, 3)),
  );
  expect(focused.arcs[1][3]).toBeGreaterThan(calm.arcs[1][3] as number);
  expect(focused.alphas[1]).toBeCloseTo(calm.alphas[1], 10);
  expect(focused.alphas[0]).toBeLessThan(calm.alphas[0] * 0.2);
});
