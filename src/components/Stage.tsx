import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ColorSpace, SplitStep } from "@relaywright/median-cut";
import type { Source } from "../hooks/useImageSource";
import type { RGB } from "../lib/color";
import type { StageSamples } from "../lib/extraction";
import { NO_SWATCH, swatchForGroup } from "../lib/stageGroups";
import { create as createGL } from "../stage/renderer";
import { create as create2D } from "../stage/painter2d";
import { drawOverlay } from "../stage/overlay";
import { flyerOrigins, project } from "../stage/math";
import {
  boxRoom,
  introLength,
  introState,
  SHORT_INTRO_MS,
} from "../stage/timeline";
import { createQualityMonitor } from "../stage/quality";
import { AUTO_SPIN, coast, dragTurn, flingSpin } from "../stage/turn";
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
/** A hand turning the cloud: where it is now, and how far it has turned. */
interface Hand {
  id: number;
  x: number;
  y: number;
  turned: number;
  // Measured when the hand takes hold, so a drag that carries on while the
  // stage restarts for new colors keeps its scale.
  width: number;
  // Touch turns the cloud only once the finger has clearly moved sideways,
  // so a swipe meant to scroll the page leaves it alone.
  sideways: boolean;
}
/** How long a swatch's groups take to stand out in the cloud, or fade back. */
const FOCUS_MS = 160;
/** Below this many pixels a finger has not yet shown which way it moves. */
const INTENT_PX = 6;
const STEPS: Record<string, number> = {
  ArrowRight: 10,
  ArrowUp: 10,
  ArrowLeft: -10,
  ArrowDown: -10,
  PageUp: 45,
  PageDown: -45,
};

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
  const hint = useRef<HTMLSpanElement>(null);
  const turner = useRef<HTMLDivElement>(null);
  // How far the cloud has turned from where it rests, and how fast it is
  // turning. It turns slowly by itself, stops while a hand holds it or the
  // keyboard is turning it, and eases back into the slow turn after. This
  // outlives each run of the effect below, so new colors for the photo never
  // snap the cloud back or drop a hand still holding it.
  const turning = useRef({
    yaw: 0,
    spin: AUTO_SPIN,
    keyed: false,
    hand: null as Hand | null,
    moves: [] as [number, number][],
  });
  const previous = useRef<Source | null>(null);
  const generation = useRef(0);
  const controls = useRef({ refresh: () => {}, skip: () => {} });
  const [view, setView] = useState(session.view);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const parent = host.current!,
      container = surface.current!,
      photo = hero.current!,
      layer = turner.current!;
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
      last = 0,
      lastDraw = 0,
      lastHook = 0,
      frames = 0,
      requested = 0;
    let length = SHORT_INTRO_MS,
      done = false,
      launched = false;
    let started = false;
    const turn = turning.current;
    // Set once the palette's deadline passes; the next frame ends the intro,
    // so a paused or slow intro never sends chips to swatches already shown.
    let overdue = false;
    const deadline = () => {
      overdue = true;
    };
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    const quality = createQualityMonitor();
    // Which swatch the pointer or keyboard is on, and how far its groups
    // stand out in the cloud (eased, 0 to 1). The groups lit stay lit while
    // the focus fades, so leaving a swatch eases out instead of snapping.
    const groupSwatch = swatchForGroup(
      result.samples.groupColors,
      result.swatches,
    );
    const lit = new Float32Array(32);
    let focused = -1,
      focus = 0;
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
    const launch = (angle: number, boxes = 1) => {
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
          const [x, y] = project(p, angle, width, height, data.fit, boxes);
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
      const intro = introState(done ? length : elapsed, length);
      const state = {
        ...intro,
        angle: -Math.PI / 4 + turn.yaw,
        points: fallback ? 4000 : quality.points,
        boxes: boxRoom(intro),
        // The palette shows through the cloud during the intro; a swatch
        // can only stand out once it is over.
        focus: done ? focus : 0,
        lit,
      };
      parent.dataset.stageAngle = String(degrees());
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
      const hinted = cloud && done && !session.turned;
      if (hint.current!.hidden === hinted) hint.current!.hidden = !hinted;
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
        launch(state.angle, state.boxes);
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
      if (!turn.hand && !turn.keyed) {
        const next = coast(turn.spin, delta);
        turn.spin = next.spin;
        turnBy(next.turned);
      }
      const goal = focused >= 0 ? 1 : 0;
      if (focus !== goal)
        focus =
          goal > focus
            ? Math.min(goal, focus + delta / FOCUS_MS)
            : Math.max(goal, focus - delta / FOCUS_MS);
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
    // Whole degrees from rest, as the slider reports them.
    const degrees = () => Math.round((turn.yaw * 180) / Math.PI) % 360;
    const turnBy = (radians: number) => {
      const full = 2 * Math.PI;
      turn.yaw = (((turn.yaw + radians) % full) + full) % full;
      const value = String(degrees());
      if (layer.getAttribute("aria-valuenow") === value) return;
      layer.setAttribute("aria-valuenow", value);
      layer.setAttribute("aria-valuetext", `${value} degrees`);
    };
    // With reduced motion, or anything else stopping the loop, a turn by
    // hand still shows at once.
    const turned = () => {
      session.turned = true;
      if (!frame) draw();
    };
    const grab = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !initialized || !current())
        return;
      // Focus is for the keyboard; a hand turns the cloud without it.
      event.preventDefault();
      layer.setPointerCapture(event.pointerId);
      turn.hand = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        turned: 0,
        width: layer.clientWidth,
        sideways: event.pointerType === "mouse",
      };
      turn.keyed = false;
      turn.spin = 0;
      turn.moves.length = 0;
      turn.moves.push([event.timeStamp, 0]);
      layer.dataset.held = "";
    };
    const drag = (event: PointerEvent) => {
      const hand = turn.hand;
      if (event.pointerId !== hand?.id || !current()) return;
      if (!hand.sideways) {
        const dx = Math.abs(event.clientX - hand.x),
          dy = Math.abs(event.clientY - hand.y);
        if (dx < INTENT_PX || dx <= dy) return;
        hand.sideways = true;
      }
      const by = dragTurn(event.clientX - hand.x, hand.width);
      hand.x = event.clientX;
      hand.turned += by;
      turn.moves.push([event.timeStamp, hand.turned]);
      if (turn.moves.length > 32) turn.moves.shift();
      turnBy(by);
      turned();
    };
    const letGo = (event: PointerEvent) => {
      if (event.pointerId !== turn.hand?.id) return;
      turn.hand = null;
      delete layer.dataset.held;
      turn.spin = reduced ? 0 : flingSpin(turn.moves, event.timeStamp);
    };
    // The browser took the gesture, usually to scroll the page: nothing the
    // hand did becomes a fling.
    const cancel = (event: PointerEvent) => {
      if (event.pointerId !== turn.hand?.id) return;
      turn.hand = null;
      turn.moves.length = 0;
      delete layer.dataset.held;
      turn.spin = 0;
    };
    const press = (event: KeyboardEvent) => {
      // Shortcuts such as Alt+Left belong to the browser.
      if (event.altKey || event.ctrlKey || event.metaKey || !current()) return;
      if (event.key === "Home") turnBy(-turn.yaw);
      else if (event.key === "End") turnBy((359 * Math.PI) / 180 - turn.yaw);
      else if (event.key in STEPS) turnBy((STEPS[event.key] * Math.PI) / 180);
      else return;
      event.preventDefault();
      turn.keyed = true;
      turn.spin = 0;
      turned();
    };
    const leave = () => {
      turn.keyed = false;
    };
    // A swatch under the pointer or holding focus lights up its groups.
    const swatchAt = (target: EventTarget | null) => {
      const color = (target as Element | null)
        ?.closest?.(".swatch")
        ?.querySelector<HTMLElement>(".swatch-color");
      const index = Number(color?.dataset.swatchIndex ?? -1);
      return index >= 0 && index < result.swatches.length ? index : -1;
    };
    const point = (index: number) => {
      if (index === focused || !current()) return;
      focused = index;
      if (index >= 0) {
        groupSwatch.forEach((swatch, group) => {
          if (group < lit.length)
            lit[group] = swatch !== NO_SWATCH && swatch === index ? 1 : 0;
        });
        parent.dataset.stageFocus = String(index);
      } else delete parent.dataset.stageFocus;
      // Without a running loop to ease it, the change shows at once.
      if (!frame) {
        focus = index >= 0 ? 1 : 0;
        if (initialized) draw();
      }
    };
    const hover = (event: PointerEvent) => point(swatchAt(event.target));
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) point(-1);
    };
    const focusIn = (event: FocusEvent) => point(swatchAt(event.target));
    const focusOut = (event: FocusEvent) => {
      if (!event.relatedTarget) point(-1);
    };
    const showPhotoOnly = () => {
      container.style.opacity = "0";
      wire.current!.style.opacity = "0";
      hint.current!.hidden = true;
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
    turnBy(0);
    layer.addEventListener("pointerdown", grab);
    layer.addEventListener("pointermove", drag);
    layer.addEventListener("pointerup", letGo);
    layer.addEventListener("pointercancel", cancel);
    layer.addEventListener("lostpointercapture", cancel);
    layer.addEventListener("keydown", press);
    layer.addEventListener("blur", leave);
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    window.addEventListener("scroll", finishFlight, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerover", hover);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
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
      layer.removeEventListener("pointerdown", grab);
      layer.removeEventListener("pointermove", drag);
      layer.removeEventListener("pointerup", letGo);
      layer.removeEventListener("pointercancel", cancel);
      layer.removeEventListener("lostpointercapture", cancel);
      layer.removeEventListener("keydown", press);
      layer.removeEventListener("blur", leave);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("scroll", finishFlight, true);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerover", hover);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      delete parent.dataset.stageFocus;
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
      <div
        className="stage-turn"
        ref={turner}
        role="slider"
        tabIndex={0}
        aria-label="Turn the color cloud"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={0}
        aria-valuetext="0 degrees"
        hidden={view === "photo"}
      />
      <span className="stage-hint" ref={hint} aria-hidden="true" hidden>
        Drag to turn
      </span>
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
