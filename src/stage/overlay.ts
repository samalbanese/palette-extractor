import type { SplitStep } from "@samalbanese/median-cut";
import { boxCorners, project, type ViewFit } from "./math";
import type { DrawState } from "./data";
import { CONDENSE } from "./timeline";

export function drawOverlay(
  canvas: HTMLCanvasElement,
  steps: SplitStep[],
  state: DrawState,
  fit: ViewFit,
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
  // Gone by the time the groups finish condensing, so nothing is left to
  // vanish in one frame when the chips leave.
  const fade = Math.max(0, 1 - state.converge / CONDENSE);
  steps.slice(0, active + 1).forEach((step, index) => {
    ctx.strokeStyle = `rgba(225,231,234,${(index === active ? 0.42 : 0.15) * fade})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    step.forEach(({ bounds }) => {
      const corners = boxCorners(bounds, fit).map((p) =>
        project(p, state.angle, width, height, fit, state.boxes),
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
