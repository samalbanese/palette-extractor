// A new photo's swatches wait as empty slots while the stage carries their
// colors in, and each fills as its chip lands. Every way an intro can end,
// or fail to start, fills them: a landing, a skip, the stage giving up, or a
// deadline that holds even when no frames run.

/** The stage's source view, kept for the whole visit. */
export const session = { view: "cloud" as "photo" | "cloud" };

// No later than this after navigation on a first load, the swatches show,
// whether or not a stage has started.
const FIRST_LOAD_DEADLINE_MS = 3400;
// Room for a later photo's stage to start and play its short intro.
const START_WAIT_MS = 1800;
// Slots shown for less than this would only flash; the palette shows instead.
const SHORTEST_HOLD_MS = 300;
const LABELS =
  ".swatch-select > span, .lock-button, .swatch-info > span, .swatch-info button";

let timer = 0;
let onDeadline: (() => void) | null = null;
let unavailable = false;
// When the slots must be full whatever a stage asks for: the first-load
// deadline for the first palette, or any palette held before it, otherwise
// no limit.
let limitAt = Infinity;
// Counts holds, so a chip launched for an earlier photo never fills a later
// photo's slot, even one in a swatch the grid has reused.
let hold = 0;
// Any of these reaching the page shows the palette whole. Click and focus
// cover assistive technology, which can activate or focus a control without
// a pointer or key event.
const INPUTS = ["pointerdown", "keydown", "click", "focusin"] as const;

const held = () => document.querySelectorAll<HTMLElement>(".swatch[data-slot]");

const release = () => {
  clearTimeout(timer);
  onDeadline = null;
  for (const input of INPUTS) removeEventListener(input, fillSlots, true);
};

const arm = (ms: number, then: (() => void) | null) => {
  clearTimeout(timer);
  onDeadline = then;
  timer = window.setTimeout(() => {
    const end = onDeadline;
    onDeadline = null;
    end?.();
    fillSlots();
  }, ms);
};

/** Whether a new photo's colors will arrive by flight. */
export const slotsWanted = () =>
  !unavailable &&
  session.view === "cloud" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

export const slotsHeld = () => held().length > 0;

/** Which hold is current; a landing from an earlier one is ignored. */
export const currentHold = () => hold;

/**
 * Empties the swatches until their colors land; call before they paint. With
 * too little of the first-load deadline left, or a first palette that came
 * after it, they show whole instead.
 */
export function holdSlots(swatches: HTMLElement[]) {
  if (!swatches.length) {
    fillSlots();
    return;
  }
  const first = hold++ === 0;
  const now = performance.now();
  limitAt =
    first || now < FIRST_LOAD_DEADLINE_MS ? FIRST_LOAD_DEADLINE_MS : Infinity;
  const wait = Math.min(START_WAIT_MS, limitAt - now);
  if (wait < SHORTEST_HOLD_MS) {
    fillSlots();
    return;
  }
  for (const swatch of swatches) swatch.dataset.slot = "";
  arm(limitAt === Infinity ? START_WAIT_MS : limitAt - now, null);
  // Input skips the intro, and the palette must be whole by the time a
  // control acts on it, even before the stage has loaded.
  for (const input of INPUTS) addEventListener(input, fillSlots, true);
}

/**
 * A stage playing the intro takes over the deadline: the slots fill no later
 * than `ms` from now, or the first-load deadline if that comes sooner, and
 * `end` runs first so the stage knows to finish.
 */
export function claimSlots(ms: number, end: () => void) {
  if (slotsHeld()) arm(Math.min(ms, limitAt - performance.now()), end);
}

/** Lets go of a claim when its stage goes away; the deadline still fills. */
export function dropClaim(end: () => void) {
  if (onDeadline === end) onDeadline = null;
}

/**
 * Fills one swatch as its color arrives, fading its labels in. `from` is the
 * hold the color was sent for; a later hold's slots keep waiting.
 */
export function fillSlot(swatch: HTMLElement | null, from = hold) {
  if (from !== hold || !swatch || !("slot" in swatch.dataset)) return;
  delete swatch.dataset.slot;
  for (const label of swatch.querySelectorAll(LABELS))
    label.animate([{ opacity: 0 }, {}], {
      duration: 100,
      easing: "ease-out",
    });
  if (!slotsHeld()) release();
}

/** Fills every swatch at once. */
export function fillSlots() {
  for (const swatch of held()) delete swatch.dataset.slot;
  release();
}

/** The stage cannot run in this browser; colors stop waiting for it. */
export function stageUnavailable() {
  unavailable = true;
  fillSlots();
}
