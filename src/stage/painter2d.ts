import { coverTransform, imagePoint, project, type Vec3 } from "./math";
import { prepare, type CloudData, type Renderer } from "./data";

export function create(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("2d")!;
  let data: CloudData | undefined;
  let width = 1,
    height = 1;
  return {
    async setSamples(samples, space) {
      data = prepare(samples, space);
      return data;
    },
    resize(w, h, dpr) {
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    draw(state) {
      if (!data) return;
      const { samples, cube, order, centroids } = data;
      const cover = coverTransform(
        samples.width,
        samples.height,
        width,
        height,
      );
      ctx.clearRect(0, 0, width, height);
      const pull = state.converge * (1 - state.release);
      ctx.globalAlpha =
        (1 - 0.4 * state.release) *
        (1 - 0.75 * state.flight * (1 - state.release));
      const pitch =
        cover.scale *
        Math.sqrt(
          (samples.width * samples.height) / Math.min(4000, order.length),
        );
      const radius =
        (pitch * 1.35 * (1 - state.toCloud) + 2.5 * state.toCloud) / 2;
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
    },
    onContextLost() {},
    dispose() {
      data = undefined;
    },
  };
}
