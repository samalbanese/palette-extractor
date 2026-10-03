import type { SplitStep } from "@relaywright/median-cut";
import { project, type Vec3 } from "./math";
import type { DrawState } from "./data";

export function drawOverlay(
  canvas: HTMLCanvasElement,
  steps: SplitStep[],
  state: DrawState,
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
  if (state.phase !== "split" && state.phase !== "converge") return;
  const active = Math.min(
    steps.length - 1,
    Math.floor(state.split * steps.length),
  );
  steps.slice(0, active + 1).forEach((step, index) => {
    ctx.strokeStyle = `rgba(225,231,234,${(index === active ? 0.42 : 0.15) * (1 - state.converge)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    step.forEach(({ bounds: { min, max } }) => {
      const corners = Array.from({ length: 8 }, (_, i) =>
        project(
          [0, 1, 2].map(
            (k) => (i & (1 << k) ? max[k] : min[k]) - 127.5,
          ) as Vec3,
          state.angle,
          width,
          height,
        ),
      );
      corners.forEach((p, i) => {
        for (let k = 0; k < 3; k++)
          if (!(i & (1 << k))) {
            ctx.moveTo(...p);
            ctx.lineTo(...corners[i | (1 << k)]);
          }
      });
    });
    ctx.stroke();
  });
}
