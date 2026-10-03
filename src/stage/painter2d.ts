import { coverTransform, imagePoint, TILT, viewScale } from "./math";
import { prepare, type CloudData, type Renderer } from "./data";

const TILT_COS = Math.cos(TILT);
const TILT_SIN = Math.sin(TILT);

export function create(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("2d")!;
  let data: CloudData | undefined;
  let width = 1,
    height = 1,
    imageScale = 1;
  // Per point, cached between frames: where it sits in the photo, and its
  // fill style with the color that style was made from.
  let frame = new Float64Array(0);
  let styles: string[] = [];
  let styleKeys = new Int32Array(0);
  const framePositions = () => {
    if (!data) return;
    const { samples } = data;
    const cover = coverTransform(samples.width, samples.height, width, height);
    imageScale = cover.scale;
    for (let i = 0; i < samples.groups.length; i++)
      frame.set(
        imagePoint(
          samples.positions[i * 2],
          samples.positions[i * 2 + 1],
          cover,
        ),
        i * 2,
      );
  };
  return {
    async setSamples(samples, space, fit) {
      data = prepare(samples, space, fit);
      frame = new Float64Array(samples.groups.length * 2);
      styles = new Array<string>(samples.groups.length);
      styleKeys = new Int32Array(samples.groups.length).fill(-1);
      framePositions();
      return data;
    },
    resize(w, h, dpr) {
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      framePositions();
    },
    draw(state) {
      if (!data) return;
      const { samples, cube, fit, order, centroids } = data;
      ctx.clearRect(0, 0, width, height);
      const pull = state.converge * (1 - state.release);
      ctx.globalAlpha =
        (1 - 0.4 * state.release) *
        (1 - 0.75 * state.flight * (1 - state.release));
      const pitch =
        imageScale *
        Math.sqrt(
          (samples.width * samples.height) / Math.min(4000, order.length),
        );
      const radius =
        (pitch * 1.35 * (1 - state.toCloud) + 2.5 * state.toCloud) / 2;
      const cos = Math.cos(state.angle),
        sin = Math.sin(state.angle);
      const scale = viewScale(width, height, fit, state.angle, state.boxes);
      for (let j = 0; j < Math.min(4000, order.length); j++) {
        const i = order[j],
          g = samples.groups[i],
          center = centroids[g]!;
        // The cube holds 32-bit floats; rounding each pulled coordinate the
        // same way keeps every point exactly where it has always landed.
        const x = Math.fround(cube[i * 3] + (center[0] - cube[i * 3]) * pull);
        const y = Math.fround(
          cube[i * 3 + 1] + (center[1] - cube[i * 3 + 1]) * pull,
        );
        const z = Math.fround(
          cube[i * 3 + 2] + (center[2] - cube[i * 3 + 2]) * pull,
        );
        const cloudX = width / 2 + (x * cos + z * sin) * scale;
        const cloudY =
          height / 2 - (y * TILT_COS - (-x * sin + z * cos) * TILT_SIN) * scale;
        const color = samples.groupColors[g];
        const r = Math.round(
          samples.colors[i * 3] * (1 - pull) + color.r * pull,
        );
        const gr = Math.round(
          samples.colors[i * 3 + 1] * (1 - pull) + color.g * pull,
        );
        const b = Math.round(
          samples.colors[i * 3 + 2] * (1 - pull) + color.b * pull,
        );
        const key = (r << 16) | (gr << 8) | b;
        if (styleKeys[i] !== key) {
          styleKeys[i] = key;
          styles[i] = `rgb(${r} ${gr} ${b})`;
        }
        ctx.fillStyle = styles[i];
        ctx.beginPath();
        ctx.arc(
          frame[i * 2] + (cloudX - frame[i * 2]) * state.toCloud,
          frame[i * 2 + 1] + (cloudY - frame[i * 2 + 1]) * state.toCloud,
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
