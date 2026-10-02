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
const LABELS =
  ".swatch-select > span, .lock-button, .swatch-info > span, .swatch-info button";

let timer = 0;
let onDeadline: (() => void) | null = null;
let unavailable = false;

const held = () => document.querySelectorAll<HTMLElement>(".swatch[data-slot]");

const release = () => {
  clearTimeout(timer);
  onDeadline = null;
  removeEventListener("pointerdown", fillSlots, true);
  removeEventListener("keydown", fillSlots, true);
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

/** Empties the swatches until their colors land; call before they paint. */
export function holdSlots(swatches: HTMLElement[]) {
  if (!swatches.length) return;
  for (const swatch of swatches) swatch.dataset.slot = "";
  arm(
    Math.max(FIRST_LOAD_DEADLINE_MS - performance.now(), START_WAIT_MS),
    null,
  );
  // Input skips the intro, and the palette must be whole by the time a
  // click or key acts on it, even before the stage has loaded.
  addEventListener("pointerdown", fillSlots, true);
  addEventListener("keydown", fillSlots, true);
}

/**
 * A stage playing the intro takes over the deadline: the slots fill no later
 * than `ms` from now, and `end` runs first so the stage knows to finish.
 */
export function claimSlots(ms: number, end: () => void) {
  if (slotsHeld()) arm(ms, end);
}

/** Lets go of a claim when its stage goes away; the deadline still fills. */
export function dropClaim(end: () => void) {
  if (onDeadline === end) onDeadline = null;
}

/** Fills one swatch as its color arrives, fading its labels in. */
export function fillSlot(swatch: HTMLElement | null) {
  if (!swatch || !("slot" in swatch.dataset)) return;
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
