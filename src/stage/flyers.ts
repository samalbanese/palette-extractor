import { rgbToHex, type RGB } from "../lib/color";

export interface Origin {
  x: number;
  y: number;
}
export interface Destination {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sample a shallow arc; only transforms change as the chip travels. */
export function flightPath(from: Origin, to: Destination): Keyframe[] {
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const arc = Math.min(70, Math.hypot(end.x - from.x, end.y - from.y) * 0.18);
  return Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    const x = from.x + (end.x - from.x) * t;
    const y = from.y + (end.y - from.y) * t - Math.sin(t * Math.PI) * arc;
    return {
      offset: t,
      transform: `translate(${x - to.width / 2}px, ${y - to.height / 2}px) scale(${10 / to.width + (1 - 10 / to.width) * t}, ${10 / to.height + (1 - 10 / to.height) * t})`,
      borderRadius: `${10 - 4 * t}px`,
    };
  });
}

export function launchFlyers(
  overlay: HTMLElement,
  origins: (Origin | null)[],
  colors: RGB[],
  duration: number,
  reduced = false,
) {
  const chips: { node: HTMLElement; animation: Animation; land: () => void }[] =
    [];
  const pulses: Animation[] = [];
  const landed = new Set<number>();
  const targets = colors.map((_, i) =>
    document.querySelector<HTMLElement>(
      `.swatch-color[data-swatch-index="${i}"]`,
    ),
  );
  const pulse = (index: number) => {
    const target = targets[index];
    if (!target || landed.has(index)) return;
    landed.add(index);
    target.dataset.stageLanding = String(
      Number(target.dataset.stageLanding ?? 0) + 1,
    );
    if (reduced) return;
    pulses.push(
      target.animate(
        [
          { opacity: 0, transform: "scale(.94)" },
          { opacity: 0.8, transform: "scale(1.015)", offset: 0.25 },
          { opacity: 0, transform: "scale(1.09)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(.16,1,.3,1)",
          pseudoElement: "::after",
        },
      ),
    );
  };
  if (!reduced)
    origins.forEach((origin, index) => {
      const target = targets[index];
      if (!origin || !target) return;
      const rect = target.getBoundingClientRect();
      if (
        rect.bottom <= 0 ||
        rect.top >= innerHeight ||
        rect.right <= 0 ||
        rect.left >= innerWidth
      )
        return;
      const node = document.createElement("div");
      node.className = "stage-flyer";
      Object.assign(node.style, {
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        background: rgbToHex(colors[index]),
      });
      overlay.append(node);
      const animation = node.animate(flightPath(origin, rect), {
        duration,
        easing: "cubic-bezier(.2,.65,.25,1)",
        fill: "both",
      });
      const land = () => {
        node.remove();
        pulse(index);
      };
      animation.onfinish = land;
      chips.push({ node, animation, land });
    });
  // Lands every chip still in the air and pulses swatches that had none.
  const landAll = () => {
    chips.forEach(({ animation, land }) => {
      if (animation.playState === "idle") return;
      animation.onfinish = null;
      animation.finish();
      land();
      animation.cancel();
    });
    targets.forEach((_, i) => pulse(i));
  };
  return {
    pulseRemaining() {
      targets.forEach((_, i) => pulse(i));
    },
    landAll,
    /** Lands everything and cuts the landing pulses short. */
    finishAll() {
      landAll();
      pulses.forEach((animation) => animation.finish());
    },
    /** Resolves once every chip and pulse started so far has ended. */
    settled() {
      // A cancelled animation gets a fresh finished promise that never
      // settles, so only animations still playing are awaited.
      return Promise.all(
        [...chips.map((c) => c.animation), ...pulses]
          .filter((a) => a.playState !== "idle")
          .map((a) => a.finished.catch(() => undefined)),
      ).then(() => undefined);
    },
    cancel() {
      chips.forEach(({ node, animation }) => {
        animation.onfinish = null;
        animation.cancel();
        node.remove();
      });
      pulses.forEach((animation) => animation.cancel());
    },
  };
}
