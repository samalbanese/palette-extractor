import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ColorSpace, SplitStep } from "@relaywright/median-cut";
import type { StageSamples } from "../lib/extraction";
import { create as createGL } from "../stage/renderer";
import { create as create2D } from "../stage/painter2d";
import type { Renderer } from "../stage/data";
import {
  cloudAtRest,
  drawTrace,
  FALLBACK_POINTS,
  traceSamples,
  type TraceState,
} from "../stage/trace";
import { Icon } from "./Icon";
import "./how-it-works.css";

interface PixelSpaceProps {
  samples: StageSamples | null;
  steps: SplitStep[];
  colorSpace: ColorSpace;
}

const STEP_MS = 700;
const TURN_MS = 12000;
/** The angle of every still frame; the rotation also starts from it. */
const STILL_ANGLE = Math.PI / 4;

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

const finalStep = (steps: SplitStep[]) => Math.max(0, steps.length - 1);

const boxCount = (count: number) => `${count} ${count === 1 ? "box" : "boxes"}`;

export function PixelSpace({ samples, steps, colorSpace }: PixelSpaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Read the preference on the first render so reduced-motion visitors never
  // get a frame of animation or its controls before the effect below runs.
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [paused, setPaused] = useState(false);
  // With reduced motion the finished split shows until the visitor scrubs.
  const [scrubbed, setScrubbed] = useState(false);
  const [replay, setReplay] = useState(0);
  const [budget, setBudget] = useState(Infinity);
  const [trace, setTrace] = useState(() => ({
    steps,
    step: reducedMotion ? finalStep(steps) : 0,
  }));
  let step = trace.step;
  if (trace.steps !== steps) {
    // A new result: autoplay starts over, a chosen step is kept where it
    // still exists, and an untouched still view shows the finished split.
    const kept = Math.min(step, finalStep(steps));
    if (reducedMotion) step = scrubbed ? kept : finalStep(steps);
    else step = paused ? kept : 0;
    setTrace({ steps, step });
  }

  const filtered = useMemo(
    () => (samples ? traceSamples(samples) : null),
    [samples],
  );
  const available = filtered?.groups.length ?? 0;
  const empty = steps.length === 0 || available === 0;
  const drawn = empty ? 0 : Math.min(available, budget);
  const animate = !reducedMotion && !paused;

  // What the drawing code reads, as of the last commit. A render that has
  // not committed yet must never reach a frame, so this is not set while
  // rendering.
  const latest = useRef({ filtered, steps, colorSpace, step, animate });
  useLayoutEffect(() => {
    latest.current = { filtered, steps, colorSpace, step, animate };
  });
  const view = useRef<{ restart(): void; sync(): void } | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion && !scrubbed)
      setTrace((t) =>
        t.step === finalStep(t.steps)
          ? t
          : { steps: t.steps, step: finalStep(t.steps) },
      );
  }, [reducedMotion, scrubbed]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const overlay = document.createElement("canvas");
    overlay.className = "trace-overlay";
    overlay.setAttribute("aria-hidden", "true");
    let points: HTMLCanvasElement;
    let renderer: Renderer;
    let limit = Infinity;
    let width = 1,
      height = 1,
      dpr = 1;
    let uploaded: { samples: StageSamples; space: ColorSpace } | null = null;
    let ready = false,
      disposed = false,
      visible = true,
      job = 0;
    let frame = 0,
      lastFrame = 0,
      stepStarted = 0,
      turnStarted = 0;

    const pointsCanvas = () => {
      const next = document.createElement("canvas");
      next.className = "trace-points";
      next.setAttribute("role", "img");
      return next;
    };
    const mount = (fallback: boolean) => {
      points = pointsCanvas();
      let next = fallback ? null : createGL(points);
      if (!next) {
        fallback = true;
        points = pointsCanvas();
        next = create2D(points);
      }
      renderer = next;
      limit = fallback ? FALLBACK_POINTS : Infinity;
      setBudget(limit);
      host.dataset.traceMode = fallback ? "2d" : "webgl";
      host.replaceChildren(points, overlay);
      renderer.resize(width, height, dpr);
      renderer.onContextLost(() => {
        renderer.dispose();
        mount(true);
        uploaded = null;
        sync();
      });
    };

    const draw = (now: number) => {
      const { filtered, steps, colorSpace, step, animate } = latest.current;
      // The turn starts from the still angle with the first frame it draws.
      if (!turnStarted) turnStarted = now;
      const state: TraceState = {
        stepIndex: step,
        angle: animate
          ? STILL_ANGLE + ((now - turnStarted) / TURN_MS) * Math.PI * 2
          : STILL_ANGLE,
        points: Math.min(filtered?.groups.length ?? 0, limit),
      };
      const label = `Image pixels in ${colorSpace === "oklab" ? "an OKLab" : "an RGB"} color cube while median-cut boxes split into the final palette`;
      if (points.getAttribute("aria-label") !== label)
        points.setAttribute("aria-label", label);
      renderer.draw(cloudAtRest(state));
      drawTrace(overlay, steps, colorSpace, state, width, height, dpr);
      host.dataset.drawnStep = String(step);
    };
    const tick = (now: number) => {
      frame = 0;
      const { steps, step, animate } = latest.current;
      if (!animate || !visible || document.hidden) return;
      if (!stepStarted) stepStarted = now;
      if (step < steps.length - 1 && now - stepStarted >= STEP_MS) {
        stepStarted = now;
        // The next step is drawn by sync once it renders.
        setTrace((t) => ({
          steps: t.steps,
          step: Math.min(t.step + 1, finalStep(t.steps)),
        }));
      }
      if (now - lastFrame >= 1000 / 30) {
        draw(now);
        lastFrame = now;
      }
      frame = requestAnimationFrame(tick);
    };
    // Draws the current step once, after uploading a new result if there is
    // one, and keeps the loop running while the trace animates on screen.
    // Still frames draw even off screen, so the panel is never blank when
    // scrolled to.
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const { filtered, colorSpace, animate } = latest.current;
      if (disposed || !filtered) return;
      if (
        !uploaded ||
        uploaded.samples !== filtered ||
        uploaded.space !== colorSpace
      ) {
        uploaded = { samples: filtered, space: colorSpace };
        ready = false;
        delete host.dataset.drawnStep;
        const current = ++job;
        void renderer.setSamples(filtered, colorSpace).then(() => {
          if (current !== job || disposed) return;
          ready = true;
          sync();
        });
        return;
      }
      if (!ready) return;
      lastFrame = performance.now();
      draw(lastFrame);
      if (animate && visible && !document.hidden)
        frame = requestAnimationFrame(tick);
    };
    const restart = () => {
      stepStarted = 0;
      turnStarted = 0;
      sync();
    };
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.resize(width, height, dpr);
      sync();
    };

    mount(false);
    view.current = { restart, sync };
    const sizing = new ResizeObserver(resize);
    sizing.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    intersection.observe(host);
    document.addEventListener("visibilitychange", sync);
    resize();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      view.current = null;
      sizing.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      renderer.dispose();
      // Release the context now rather than whenever the canvas is collected.
      points
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext();
      host.replaceChildren();
      delete host.dataset.drawnStep;
    };
  }, [empty]);

  useLayoutEffect(() => view.current?.restart(), [replay, steps, animate]);
  useLayoutEffect(() => view.current?.sync(), [step, filtered, colorSpace]);

  const select = (index: number) => setTrace({ steps, step: index });
  const pause = () => setPaused(true);

  return (
    <section aria-labelledby="pixel-space-heading" className="algorithm-panel">
      <div className="panel-intro">
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
            <strong>{drawn.toLocaleString()}</strong>
            <span>pixels visualized</span>
          </div>
          <div>
            <strong>{steps[step]?.length ?? 0}</strong>
            <span>color groups</span>
          </div>
          <div>
            <strong>100%</strong>
            <span>in your browser</span>
          </div>
        </div>
      </div>
      {empty ? (
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
            <span>{animate ? "LIVE EXTRACTION TRACE" : "STATIC VIEW"}</span>
          </div>
          <div
            ref={hostRef}
            className="algorithm-renderer"
            data-step={step}
            data-trace-points={drawn}
          />
          {steps.length > 1 && (
            <label className="algorithm-scrubber">
              Split step
              <input
                type="range"
                min={0}
                max={steps.length - 1}
                step={1}
                value={step}
                aria-valuetext={`Step ${step + 1} of ${steps.length}: ${boxCount(steps[step]?.length ?? 0)}`}
                onPointerDown={pause}
                onFocus={pause}
                onChange={(event) => {
                  pause();
                  setScrubbed(true);
                  select(Number(event.target.value));
                }}
              />
            </label>
          )}
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
                    {paused ? "Play animation" : "Stop animation"}
                  </button>
                  <button
                    onClick={() => {
                      setPaused(false);
                      select(0);
                      setReplay((v) => v + 1);
                    }}
                  >
                    <Icon name="refresh" size={12} /> Replay
                  </button>
                </>
              )}
            </div>
            <span>
              {step + 1} / {steps.length} steps
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
