import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { type RGB, labelColorFor, rgbToHex } from "../lib/color";
import {
  colorAt,
  colorChange,
  EASE_IN_OUT_CUBIC,
  MORPH_MS,
  planMorph,
  settledAt,
  type ColorTimeline,
} from "../lib/morph";
import { nearestColorName } from "../lib/names";
import { Swatch, type ValueKind } from "./Swatch";

export interface PaletteEntry {
  color: RGB;
  population: number;
}
export interface PresentedSwatch extends PaletteEntry {
  /** Stays with the swatch through sorts, recounts and recolors. */
  id: string;
  /** The swatch survived and its color changed. */
  retarget: boolean;
}
export interface Presentation {
  swatches: PresentedSwatch[];
  /** A new photo: colors take their final values instead of melting. */
  finalColors: boolean;
  /** Counts new photos, so a selection can tell it belongs to an older one. */
  photo: number;
}

const empty: Presentation = { swatches: [], finalColors: false, photo: 0 };

/**
 * Matches each new palette to the swatches on screen, so surviving swatches
 * keep their IDs. Plans are made against the last committed palette only, so
 * a render React throws away never leaves a half-applied match behind.
 */
export function usePresentation(
  sorted: PaletteEntry[],
  loaded: object | null,
  lockedSet: Set<string>,
): Presentation {
  const committed = useRef({
    presentation: empty,
    loaded: null as object | null,
  });
  const lastId = useRef(0);
  // Locks only matter at the moment a new palette arrives, so they are read
  // here rather than listed as a reason to plan again.
  const isLocked = (color: RGB) => lockedSet.has(rgbToHex(color));
  const presentation = useMemo(() => {
    const previous = committed.current;
    // Displayed colors live in the grid's animation loop; matching only
    // needs targets, and the grid melts from whatever is on screen.
    const plan = planMorph(
      previous.presentation.swatches.map((swatch) => ({
        id: swatch.id,
        rgb: swatch.color,
        target: swatch.color,
        locked: isLocked(swatch.color),
      })),
      sorted.map((entry) => ({
        rgb: entry.color,
        locked: isLocked(entry.color),
      })),
      () => `swatch-${++lastId.current}`,
    );
    const finalColors = colorChange(previous.loaded, loaded) === "final";
    return {
      swatches: plan.items.map((item, slot) => ({
        id: item.id,
        color: item.to,
        population: sorted[slot].population,
        retarget: item.retarget,
      })),
      finalColors,
      photo: previous.presentation.photo + (finalColors ? 1 : 0),
    };
  }, [sorted, loaded]);
  useLayoutEffect(() => {
    committed.current = { presentation, loaded };
  }, [presentation, loaded]);
  return presentation;
}

/**
 * Reads the swatches' on-screen boxes just before React moves them, which no
 * effect can do: effects run after the DOM has changed.
 */
class BeforeUpdate extends Component<{
  watch: unknown;
  onBefore: () => void;
  children: ReactNode;
}> {
  getSnapshotBeforeUpdate(previous: { watch: unknown }) {
    if (previous.watch !== this.props.watch) this.props.onBefore();
    return null;
  }
  // React only asks for a snapshot from components that also define this.
  componentDidUpdate() {}
  render() {
    return this.props.children;
  }
}

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const motionOf = (swatch: HTMLElement) =>
  swatch.querySelector<HTMLElement>(":scope > .swatch-motion")!;

export function SwatchGrid({
  presentation,
  valueKind,
  total,
  showWeights,
  lockedSet,
  canLock,
  changedHexes,
  copied,
  onCopy,
  onToggleLock,
  selectedId,
  onSelect,
}: {
  presentation: Presentation;
  valueKind: ValueKind;
  total: number;
  showWeights: boolean;
  lockedSet: Set<string>;
  canLock: boolean;
  changedHexes: Set<string>;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
  onToggleLock: (color: RGB) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const timelines = useRef(new Map<string, ColorTimeline>());
  // The color each swatch last painted, which is where a new melt begins.
  const shown = useRef(new Map<string, RGB>());
  const before = useRef(new Map<string, DOMRect>());
  const loop = useRef({ frame: 0, timer: 0, requested: 0, endsAt: 0 });
  const finish = useRef(() => {});

  const swatchElements = () =>
    [...grid.current!.querySelectorAll<HTMLElement>(":scope > .swatch")].map(
      (element) => ({ element, id: element.dataset.swatchId! }),
    );

  const measure = () => {
    before.current = new Map(
      swatchElements().map(({ element, id }) => [
        id,
        motionOf(element).getBoundingClientRect(),
      ]),
    );
  };

  useLayoutEffect(() => {
    const node = grid.current!;
    const now = performance.now();
    const reduced = reducedMotion();
    const boxes = before.current;
    before.current = new Map();

    // A changed target melts from the color on screen; an unchanged one
    // keeps its running timeline untouched.
    const next = new Map<string, ColorTimeline>();
    for (const swatch of presentation.swatches) {
      const running = timelines.current.get(swatch.id);
      next.set(
        swatch.id,
        reduced || presentation.finalColors || !running
          ? settledAt(swatch.color)
          : swatch.retarget
            ? {
                from: shown.current.get(swatch.id) ?? colorAt(running, now),
                to: swatch.color,
                start: now,
              }
            : running,
      );
    }
    timelines.current = next;

    const elements = swatchElements();
    const paint = (time: number) => {
      shown.current = new Map();
      for (const { element, id } of elements) {
        const color = colorAt(timelines.current.get(id)!, time);
        shown.current.set(id, color);
        const hex = rgbToHex(color);
        if (element.style.getPropertyValue("--swatch") === hex) continue;
        element.style.setProperty("--swatch", hex);
        element.style.setProperty("--label", labelColorFor(color));
      }
    };
    const moves: Animation[] = [];
    for (const { element, id } of elements) {
      const motion = motionOf(element);
      for (const animation of motion.getAnimations())
        if (animation.id === "morph-move") animation.cancel();
      const first = boxes.get(id);
      if (reduced || !first) continue;
      const last = motion.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const move = motion.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: MORPH_MS, easing: EASE_IN_OUT_CUBIC },
      );
      move.id = "morph-move";
      moves.push(move);
    }

    const state = loop.current;
    const settle = () => {
      cancelAnimationFrame(state.frame);
      clearTimeout(state.timer);
      state.frame = 0;
      node.dataset.morph = "idle";
    };
    const tick = () => {
      state.frame = 0;
      const time = performance.now();
      paint(time);
      if (time >= state.endsAt) settle();
      else request();
    };
    const request = () => {
      node.dataset.morphRaf = String(++state.requested);
      state.frame = requestAnimationFrame(tick);
    };
    finish.current = () => {
      for (const [id, timeline] of timelines.current)
        timelines.current.set(id, settledAt(timeline.to));
      moves.forEach((move) => move.cancel());
      paint(performance.now());
      settle();
    };

    node.dataset.morphStartedAt = String(Math.round(now));
    paint(now);
    if (reduced) {
      settle();
      return;
    }
    state.endsAt = now + MORPH_MS;
    node.dataset.morph = "running";
    // Frames are only needed while some color is still changing. A change
    // that only moves or adds swatches (including the first palette) keeps
    // the main thread free and just ends the morph on time.
    const melting = [...timelines.current.values()].some(
      ({ from, to, start }) =>
        start + MORPH_MS > now &&
        (from.r !== to.r || from.g !== to.g || from.b !== to.b),
    );
    if (melting) request();
    else state.timer = window.setTimeout(settle, MORPH_MS);
    return () => {
      cancelAnimationFrame(state.frame);
      clearTimeout(state.timer);
    };
  }, [presentation]);

  // Turning on reduced motion mid-morph lands everything at once.
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      if (media.matches) finish.current();
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  return (
    <div
      ref={grid}
      className={`swatch-grid format-${valueKind}`}
      data-morph="idle"
      data-morph-raf="0"
    >
      <BeforeUpdate watch={presentation} onBefore={measure}>
        {presentation.swatches.map((swatch, i) => {
          const hex = rgbToHex(swatch.color);
          return (
            <Swatch
              key={swatch.id}
              id={swatch.id}
              color={swatch.color}
              index={i}
              locked={lockedSet.has(hex)}
              weight={total ? swatch.population / total : 0}
              name={nearestColorName(swatch.color)}
              onToggleLock={() => onToggleLock(swatch.color)}
              valueKind={valueKind}
              onCopy={onCopy}
              copied={copied}
              selected={swatch.id === selectedId}
              onSelect={() => onSelect(swatch.id)}
              showWeight={showWeights}
              canLock={canLock}
              changed={changedHexes.has(hex)}
            />
          );
        })}
      </BeforeUpdate>
    </div>
  );
}
