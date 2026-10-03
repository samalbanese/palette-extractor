import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ColorSpace, SplitStep } from "@samalbanese/median-cut";
import type { Source } from "../hooks/useImageSource";
import type { RGB } from "../lib/color";
import type { StageSamples } from "../lib/extraction";
import { swatchForGroup } from "../lib/stageGroups";
import { create as createGL } from "../stage/renderer";
import { create as create2D } from "../stage/painter2d";
import { drawOverlay } from "../stage/overlay";
import { flyerOrigins, project } from "../stage/math";
import { introLength, introState, SHORT_INTRO_MS } from "../stage/timeline";
import { createQualityMonitor } from "../stage/quality";
import { launchFlyers } from "../stage/flyers";
import { yieldTask, type CloudData, type Renderer } from "../stage/data";
import {
  claimSlots,
  currentHold,
  dropClaim,
  fillSlot,
  fillSlots,
  session,
  slotsHeld,
  stageUnavailable,
} from "../stage/handoff";

export interface StageResult {
  image: Source;
  samples: StageSamples;
  steps: SplitStep[];
  colorSpace: ColorSpace;
  swatches: RGB[];
  populations: number[];
}
export default function Stage({
  result,
  host,
  hero,
}: {
  result: StageResult;
  host: RefObject<HTMLDivElement>;
  hero: RefObject<HTMLImageElement>;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const wire = useRef<HTMLCanvasElement>(null);
  const portal = useRef<HTMLDivElement>(null);
  const inset = useRef<HTMLImageElement>(null);
  const previous = useRef<Source | null>(null);
  const generation = useRef(0);
  const controls = useRef({ refresh: () => {}, skip: () => {} });
  const [view, setView] = useState(session.view);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const parent = host.current!,
      container = surface.current!,
      photo = hero.current!;
    const token = ++generation.current;
    let disposed = false,
      renderer: Renderer | null = null,
      canvas: HTMLCanvasElement;
    let data: CloudData, flights: ReturnType<typeof launchFlyers> | undefined;
    let frame = 0,
      visible = true,
      initialized = false,
      fallback = false;
    let width = 1,
      height = 1,
      dpr = 1,
      elapsed = 0,
      rotation = 0,
      last = 0,
      lastDraw = 0,
      lastHook = 0,
      frames = 0,
      requested = 0;
    let length = SHORT_INTRO_MS,
      done = false,
      launched = false;
    let started = false;
    // Set once the palette's deadline passes; the next frame ends the intro,
    // so a paused or slow intro never sends chips to swatches already shown.
    let overdue = false;
    const deadline = () => {
      overdue = true;
    };
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    const quality = createQualityMonitor();
    // The palette this stage delivers colors to. React holds a new photo's
    // slots before this effect starts, so once another palette is held, an
    // older stage has nothing left to fill or claim.
    const hold = currentHold();
    const current = () =>
      !disposed && generation.current === token && currentHold() === hold;
    const mode = (value: string) => {
      parent.dataset.stageMode = value;
    };
    // Every frame the stage asks for is counted, so tests can tell an idle
    // stage from one that quietly keeps drawing.
    const raf = (callback: FrameRequestCallback) => {
      parent.dataset.stageRaf = String(++requested);
      return requestAnimationFrame(callback);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      parent.dataset.stageLoop = "idle";
    };
    // A skip cuts the landing pulses short; a natural ending lets them play.
    // Either way the finish time is taken once nothing is left moving.
    const markDone = (cut: boolean) => {
      if (done) return;
      done = true;
      elapsed = length;
      // Ending before the flight still lands every color; launching here lets
      // a skip cut those pulses short with the rest.
      if (!launched) launch(0);
      if (cut) flights?.finishAll();
      else flights?.landAll();
      parent.dataset.stagePhase = "done";
      void (flights?.settled() ?? Promise.resolve()).then(() => {
        if (!current()) return;
        raf(() => {
          if (current())
            parent.dataset.stageDoneAt = String(Math.round(performance.now()));
        });
      });
    };
    // Sends each color from the centre of its group to its swatch. Once the
    // intro is over, or with reduced motion, nothing flies and swatches only
    // pulse.
    const launch = (angle: number) => {
      launched = true;
      const origins = flyerOrigins(
        data.centroids,
        data.counts,
        swatchForGroup(result.samples.groupColors, result.swatches),
        result.swatches.length,
      );
      const rect = canvas.getBoundingClientRect();
      flights = launchFlyers(
        portal.current!,
        origins.map((p) => {
          if (!p || done || reduced) return null;
          const [x, y] = project(p, angle, width, height, data.fit);
          return { x: rect.left + x, y: rect.top + y };
        }),
        result.swatches,
        Math.max(1, length * 0.9 - elapsed),
        reduced,
        (target) => {
          if (current()) fillSlot(target.closest<HTMLElement>(".swatch"), hold);
        },
      );
    };
    // Once a newer photo holds the swatches, this stage has nothing left to
    // show or send, so it stops before its next frame.
    const draw = () => {
      if (!initialized || !current()) return;
      if (overdue && !done) markDone(true);
      const state = {
        ...introState(done ? length : elapsed, length),
        angle: -Math.PI / 4 + (reduced ? 0 : (rotation * Math.PI * 2) / 24000),
        points: fallback ? 4000 : quality.points,
      };
      if (state.done) markDone(false);
      if (!started && !done) {
        started = true;
        parent.dataset.stageStartedAt = String(Math.round(performance.now()));
      }
      parent.dataset.stageStep = state.phase;
      parent.dataset.stagePoints = String(
        Math.min(state.points, result.samples.groups.length),
      );
      const cloud = viewRef.current === "cloud";
      container.style.opacity = cloud ? "1" : "0";
      wire.current!.style.opacity = cloud ? "1" : "0";
      photo.style.opacity = cloud
        ? String(1 - Math.min(1, elapsed / (length * 0.1)))
        : "1";
      inset.current!.style.opacity = cloud ? String(state.release) : "0";
      if (cloud) renderer!.draw(state);
      drawOverlay(
        wire.current!,
        result.steps,
        state,
        data.fit,
        width,
        height,
        dpr,
      );
      parent.dataset.stageSpace = result.colorSpace;
      frames++;
      if (performance.now() - lastHook >= 250 || frames === 1) {
        parent.dataset.stageFrames = String(frames);
        lastHook = performance.now();
      }
      if (
        !launched &&
        (state.phase === "flight" || state.phase === "release" || state.done)
      )
        launch(state.angle);
      if (state.release > 0) flights?.pulseRemaining();
      if (done) flights?.landAll();
    };
    const active = () =>
      initialized &&
      current() &&
      visible &&
      !document.hidden &&
      !reduced &&
      viewRef.current === "cloud";
    const tick = (now: number) => {
      frame = 0;
      if (!active()) {
        stop();
        return;
      }
      const delta = last ? now - last : 0;
      last = now;
      elapsed += delta;
      rotation += delta;
      if (!fallback) quality.record(delta);
      if (
        !fallback ||
        now - lastDraw >= 1000 / 30 ||
        (elapsed >= length && !done)
      ) {
        draw();
        lastDraw = now;
      }
      frame = raf(tick);
      parent.dataset.stageLoop = "running";
    };
    const showPhotoOnly = () => {
      container.style.opacity = "0";
      wire.current!.style.opacity = "0";
      inset.current!.style.opacity = "0";
      photo.style.opacity = "1";
    };
    const refresh = () => {
      stop();
      // Before the first frame, or after a failed start, only the view
      // choice applies: Photo must still show the photo.
      if (!initialized) {
        if (viewRef.current === "photo") showPhotoOnly();
        return;
      }
      draw();
      if (active()) {
        frame = raf(tick);
        parent.dataset.stageLoop = "running";
      }
    };
    const skip = () => {
      if (!current()) return;
      // Whatever ends the intro early shows the whole palette at once.
      fillSlots();
      if (initialized && !done) {
        markDone(true);
        refresh();
      }
    };
    controls.current = { refresh, skip };
    const resize = () => {
      flights?.finishAll();
      const bounds = parent.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      dpr = Math.min(devicePixelRatio, 2);
      renderer?.resize(width, height, dpr);
      refresh();
    };
    const newCanvas = () => {
      const next = document.createElement("canvas");
      next.className = "stage-points";
      next.setAttribute("role", "img");
      next.setAttribute(
        "aria-label",
        `${result.image.name} as a cloud of its colors in ${result.colorSpace === "oklab" ? "Perceptual" : "RGB"} space`,
      );
      // The previous canvas keeps showing its last frame until this one draws.
      for (const old of container.children)
        old.setAttribute("aria-hidden", "true");
      container.append(next);
      canvas = next;
      return next;
    };
    // Removes the canvases the current one replaced and releases their
    // contexts, so repeated changes never pile up live WebGL contexts.
    const dropStale = () => {
      for (const old of [...container.children]) {
        if (old === canvas) continue;
        (old as HTMLCanvasElement)
          .getContext("webgl2")
          ?.getExtension("WEBGL_lose_context")
          ?.loseContext();
        old.remove();
      }
    };
    const contextLost = async () => {
      stop();
      initialized = false;
      renderer?.dispose();
      fallback = true;
      renderer = create2D(newCanvas());
      renderer.resize(width, height, dpr);
      data = await renderer.setSamples(result.samples, result.colorSpace);
      if (!current()) return;
      mode("2d");
      initialized = true;
      refresh();
      dropStale();
    };
    const start = async () => {
      try {
        await photo.decode();
      } catch {
        // This photo cannot become points. Show it as it is, with nothing
        // left over from the cloud it replaces.
        if (!current()) return;
        fillSlots();
        dropStale();
        delete parent.dataset.stageStep;
        showPhotoOnly();
        return;
      }
      if (!current()) return;
      renderer = createGL(newCanvas());
      if (!renderer) {
        fallback = true;
        renderer = create2D(newCanvas());
      }
      renderer.onContextLost(() => void contextLost());
      await yieldTask();
      if (!current()) return;
      resize();
      data = await renderer.setSamples(result.samples, result.colorSpace);
      if (!current()) return;
      const replay = previous.current !== result.image;
      let seen = false;
      try {
        seen = sessionStorage.getItem("stage-intro-seen") === "1";
      } catch {
        /* Storage can be disabled. */
      }
      length = seen
        ? SHORT_INTRO_MS
        : introLength(3500 - performance.now() - 300);
      previous.current = result.image;
      try {
        sessionStorage.setItem("stage-intro-seen", "1");
      } catch {
        /* A later load can use the full intro. */
      }
      initialized = true;
      mode(fallback ? "2d" : "webgl");
      // The host outlives each intro; drop the previous one's timings.
      delete parent.dataset.stageStartedAt;
      delete parent.dataset.stageDoneAt;
      delete parent.dataset.stageEndsAt;
      parent.dataset.stagePhase = "intro";
      // The photo's own reveal animation would override the fade below the
      // points, so it ends as the stage takes over.
      photo.getAnimations().forEach((animation) => animation.finish());
      // A change to the same photo has no new colors to deliver.
      if (!replay) launched = true;
      // Colors fly only into swatches still waiting for them; input or a
      // deadline that came first already showed the palette.
      if (reduced || !replay || viewRef.current === "photo" || !slotsHeld())
        markDone(true);
      else {
        // However slowly frames come, the palette shows soon after the
        // planned end, with nothing left in flight.
        claimSlots(length + 600, deadline);
        parent.dataset.stageEndsAt = String(
          Math.round(performance.now() + length),
        );
      }
      refresh();
      dropStale();
    };
    const preference = () => {
      reduced = media.matches;
      if (reduced) skip();
      refresh();
    };
    const finishFlight = () => flights?.finishAll();
    // Coming back always refreshes: a stage that started while hidden never
    // had a loop to resume, and refresh only runs one when the stage is live.
    const visibility = () => {
      if (document.hidden) stop();
      else refresh();
    };
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    intersection.observe(parent);
    const sizing = new ResizeObserver(resize);
    sizing.observe(parent);
    media.addEventListener("change", preference);
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    window.addEventListener("scroll", finishFlight, true);
    document.addEventListener("visibilitychange", visibility);
    void start().catch(() => {
      // Neither renderer could start here, so no stage will deliver colors.
      if (current()) stageUnavailable();
    });
    return () => {
      disposed = true;
      dropClaim(deadline);
      stop();
      flights?.finishAll();
      flights?.cancel();
      renderer?.dispose();
      intersection.disconnect();
      sizing.disconnect();
      media.removeEventListener("change", preference);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("scroll", finishFlight, true);
      document.removeEventListener("visibilitychange", visibility);
      photo.style.opacity = "";
    };
  }, [result, host, hero]);

  // The host outlives this component, so a stage mounted later must not
  // inherit the mark that says a frame is on screen.
  useEffect(() => {
    const parent = host.current;
    return () => {
      if (parent) {
        delete parent.dataset.stageStep;
        delete parent.dataset.stageSpace;
      }
    };
  }, [host]);

  return (
    <>
      <div
        className="stage-surface"
        ref={surface}
        aria-hidden={view === "photo"}
      />
      <canvas className="stage-wire" ref={wire} aria-hidden="true" />
      <img className="stage-inset" ref={inset} src={result.image.src} alt="" />
      <div
        className="value-switch stage-switch"
        role="group"
        aria-label="Source view"
      >
        {(
          [
            ["photo", "Photo"],
            ["cloud", "Color space"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={view === value}
            onClick={() => {
              controls.current.skip();
              session.view = value;
              viewRef.current = value;
              setView(value);
              controls.current.refresh();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {createPortal(
        <div className="stage-flyers" aria-hidden="true" ref={portal} />,
        document.body,
      )}
    </>
  );
}
