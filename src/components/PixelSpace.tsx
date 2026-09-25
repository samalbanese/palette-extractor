import { useEffect, useRef, useState } from "react";
import { rgbToHex } from "../lib/color";
import {
  oklabCoords,
  type ColorSpace,
  type Pixel,
  type SplitStep,
  type WeightedColor,
} from "@samalbanese/median-cut";
import { Icon } from "./Icon";

interface PixelSpaceProps {
  pixels: Pixel[];
  steps: SplitStep[];
  palette: WeightedColor[];
  colorSpace: ColorSpace;
}

const MORPH_DURATION_MS = 800;

// Legend for the cube's x, y, and z axes. OKLab's are lightness, then the
// green-red and blue-yellow opponent axes.
const AXES: Record<ColorSpace, Array<[string, string]>> = {
  rgb: [
    ["R", "#e8a69e"],
    ["G", "#afccb6"],
    ["B", "#9fbdde"],
  ],
  oklab: [
    ["L", "#d9d6cf"],
    ["a", "#e8a69e"],
    ["b", "#9fbdde"],
  ],
};

function coordsFor(pixel: Pixel, colorSpace: ColorSpace): Pixel {
  return colorSpace === "oklab" ? oklabCoords(pixel) : pixel;
}

function lerp(from: Pixel, to: Pixel, t: number): Pixel {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/** Cubic ease-in-out, used to morph dots between color spaces. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

interface Point2D {
  x: number;
  y: number;
}

const BOX_EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];

export function PixelSpace({
  pixels,
  steps,
  palette,
  colorSpace,
}: PixelSpaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [replay, setReplay] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [activeStep, setActiveStep] = useState(0);
  const previousColorSpace = useRef<ColorSpace>(colorSpace);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [pixels.length]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let lastFrame = 0;
    let lastStep = 0;
    let stepIndex = reducedMotion || paused ? Math.max(0, steps.length - 1) : 0;
    setActiveStep(stepIndex);
    const startedAt = performance.now();

    // When a result arrives from the other color space, dots glide from
    // their old positions to the new ones. First mount, replays, and new
    // results in the same space draw in place. Positions are converted once
    // here, not on every frame.
    const fromSpace = previousColorSpace.current;
    previousColorSpace.current = colorSpace;
    const morphing = fromSpace !== colorSpace && !reducedMotion && !paused;
    const targets = pixels.map((pixel) => coordsFor(pixel, colorSpace));
    const origins = morphing
      ? pixels.map((pixel) => coordsFor(pixel, fromSpace))
      : targets;
    const morphStartedAt = performance.now();
    const morphProgress = (now: number) =>
      morphing
        ? easeInOut(Math.min(1, (now - morphStartedAt) / MORPH_DURATION_MS))
        : 1;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * dpr));
      canvas.height = Math.max(1, Math.round(bounds.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now());
    };

    const project = (
      point: Pixel,
      angle: number,
      width: number,
      height: number,
    ): Point2D => {
      const x = point[0] - 127.5;
      const y = point[1] - 127.5;
      const z = point[2] - 127.5;
      const cosY = Math.cos(angle);
      const sinY = Math.sin(angle);
      const rotatedX = x * cosY + z * sinY;
      const rotatedZ = -x * sinY + z * cosY;
      const tilt = Math.PI / 9;
      const rotatedY = y * Math.cos(tilt) - rotatedZ * Math.sin(tilt);
      const scale = (Math.min(width, height) - 44) / 360;
      return {
        x: width / 2 + rotatedX * scale,
        y: height / 2 - rotatedY * scale,
      };
    };

    const drawBox = (
      bounds: SplitStep[number]["bounds"],
      angle: number,
      width: number,
      height: number,
      stroke: string,
    ) => {
      const { min, max } = bounds;
      const corners: Pixel[] = [
        [min[0], min[1], min[2]],
        [max[0], min[1], min[2]],
        [min[0], max[1], min[2]],
        [max[0], max[1], min[2]],
        [min[0], min[1], max[2]],
        [max[0], min[1], max[2]],
        [min[0], max[1], max[2]],
        [max[0], max[1], max[2]],
      ];
      const projected = corners.map((corner) =>
        project(corner, angle, width, height),
      );
      ctx.beginPath();
      for (const [from, to] of BOX_EDGES) {
        ctx.moveTo(projected[from].x, projected[from].y);
        ctx.lineTo(projected[to].x, projected[to].y);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const draw = (now: number) => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width;
      const height = bounds.height;
      const angle =
        reducedMotion || paused
          ? Math.PI / 4
          : ((now - startedAt) / 12000) * Math.PI * 2;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#1b1e20";
      ctx.fillRect(0, 0, width, height);

      // Faint frame of the full RGB cube grounds the rotation spatially.
      drawBox(
        { min: [0, 0, 0], max: [255, 255, 255] },
        angle,
        width,
        height,
        "rgba(218, 226, 231, 0.15)",
      );

      const t = morphProgress(now);
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < pixels.length; i++) {
        const pixel = pixels[i];
        const coords = t === 1 ? targets[i] : lerp(origins[i], targets[i], t);
        const point = project(coords, angle, width, height);
        ctx.fillStyle = `rgb(${pixel[0]} ${pixel[1]} ${pixel[2]})`;
        ctx.fillRect(point.x - 1.3, point.y - 1.3, 2.6, 2.6);
      }
      ctx.globalAlpha = 1;

      const current = steps[stepIndex];
      if (current) {
        for (const box of current) {
          drawBox(
            box.bounds,
            angle,
            width,
            height,
            "rgba(218, 226, 231, 0.42)",
          );
        }
      }

      const atFinal = steps.length === 0 || stepIndex === steps.length - 1;
      if (atFinal) {
        const finals =
          current ??
          palette.map((entry) => ({
            color: entry.color,
            population: entry.population,
          }));
        const total = finals.reduce((sum, entry) => sum + entry.population, 0);
        for (const { color, population } of finals) {
          // Dot size tracks how much of the image the color covers.
          const radius = 4.5 + Math.sqrt(total ? population / total : 0) * 7;
          const rgb: Pixel = [color.r, color.g, color.b];
          const coords = lerp(
            coordsFor(rgb, morphing ? fromSpace : colorSpace),
            coordsFor(rgb, colorSpace),
            t,
          );
          const point = project(coords, angle, width, height);
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = rgbToHex(color);
          ctx.fill();
          ctx.strokeStyle = "#e5dfd2";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    };

    const tick = (now: number) => {
      if (document.visibilityState !== "visible" || !visible) return;
      if (
        !reducedMotion &&
        !paused &&
        steps.length > 1 &&
        stepIndex < steps.length - 1
      ) {
        if (!lastStep) lastStep = now;
        if (now - lastStep >= 700) {
          stepIndex += 1;
          setActiveStep(stepIndex);
          lastStep = now;
        }
      }
      if (now - lastFrame >= 1000 / 30) {
        draw(now);
        lastFrame = now;
      }
      if (!reducedMotion && !paused) frame = requestAnimationFrame(tick);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      if (document.visibilityState === "visible" && visible) {
        if (reducedMotion || paused) draw(performance.now());
        else frame = requestAnimationFrame(tick);
      }
    };
    const onVisibility = () => start();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    start();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    palette,
    pixels,
    reducedMotion,
    replay,
    steps,
    paused,
    visible,
    colorSpace,
  ]);

  return (
    <section aria-labelledby="pixel-space-heading" className="algorithm-panel">
      <div className="panel-intro">
        <span className="eyebrow">THE METHOD BEHIND THE MOOD</span>
        <h2 id="pixel-space-heading">
          A little color science.
          <br />
          No black box.
        </h2>
        <p>
          The actual sampled pixels from your image, mapped into
          three-dimensional color space. Watch them become a palette.
        </p>
        <ol className="step-list">
          <li>
            <b>1</b>
            <span>
              <strong>Sample the image.</strong>
              <br />
              Resize to 320px and skip transparent pixels.
            </span>
          </li>
          <li>
            <b>2</b>
            <span>
              <strong>Find the color families.</strong>
              <br />
              Median cut divides the widest color ranges into smaller groups.
            </span>
          </li>
          <li>
            <b>3</b>
            <span>
              <strong>Keep a real color.</strong>
              <br />
              Pick the sampled pixel nearest each group&apos;s average.
            </span>
          </li>
        </ol>
        <div className="algorithm-stats">
          <div>
            <strong>{pixels.length.toLocaleString()}</strong>
            <span>pixels visualized</span>
          </div>
          <div>
            <strong>{steps[activeStep]?.length ?? 0}</strong>
            <span>color groups</span>
          </div>
          <div>
            <strong>100%</strong>
            <span>in your browser</span>
          </div>
        </div>
      </div>
      {pixels.length === 0 ? (
        <p className="contrast-empty">
          No pixels to plot yet. Add an image and leave at least one color
          unlocked to watch the algorithm work.
        </p>
      ) : (
        <div className="algorithm-canvas">
          <div className="cube-topline">
            <span>
              {colorSpace === "oklab"
                ? "OKLAB / COLOR SPACE"
                : "RGB / COLOR SPACE"}
            </span>
            <span>
              {paused || reducedMotion
                ? "STATIC VIEW"
                : "LIVE EXTRACTION TRACE"}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            aria-label={
              colorSpace === "oklab"
                ? "Image pixels rotating in an OKLab color cube while median-cut boxes split into the final palette"
                : "Image pixels rotating in an RGB color cube while median-cut boxes split into the final palette"
            }
          />
          <div className="cube-bottomline">
            <div className="cube-legend">
              {AXES[colorSpace].map(([label, color]) => (
                <span key={label} style={{ color }}>
                  <i />
                  {label}
                </span>
              ))}
            </div>
            <div className="animation-controls">
              {!reducedMotion && (
                <>
                  <button onClick={() => setPaused((v) => !v)}>
                    {paused ? "Play animation" : "Static view"}
                  </button>
                  <button
                    onClick={() => {
                      setPaused(false);
                      setReplay((v) => v + 1);
                    }}
                  >
                    <Icon name="refresh" size={12} /> Replay
                  </button>
                </>
              )}
            </div>
            <span>
              {activeStep + 1} / {steps.length} steps
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
