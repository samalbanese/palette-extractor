export const FULL_INTRO_MS = 3000;
export const SHORT_INTRO_MS = 1200;

export type IntroPhase =
  | "lift"
  | "settle"
  | "split"
  | "converge"
  | "flight"
  | "release"
  | "done";

export interface IntroState {
  phase: IntroPhase;
  /** Photo position (0) to cloud position (1). */
  toCloud: number;
  /** Progress through the recorded splits. */
  split: number;
  /**
   * Pull toward each group's centroid and color. It stops short of a full
   * collapse during the intro, so each group stays a visible cluster for its
   * chip to leave from.
   */
  converge: number;
  /**
   * Flyers leaving the cloud for their swatches. It starts slowly, so the
   * groups stay bright while their chips leave and dim as the chips land.
   */
  flight: number;
  /** Points spreading back out to their own colors. */
  release: number;
  done: boolean;
}

// Phase starts on the full-length clock; shorter intros scale them evenly.
const STARTS: [IntroPhase, number][] = [
  ["lift", 0],
  ["settle", 800],
  ["split", 1400],
  ["converge", 2000],
  ["flight", 2250],
  ["release", 2700],
];

// How far the groups condense before their chips leave.
const CONDENSE = 0.8;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** As long as the remaining time allows, between the short and full intro. */
export function introLength(remainingMs: number): number {
  return Math.round(
    Math.min(FULL_INTRO_MS, Math.max(SHORT_INTRO_MS, remainingMs)),
  );
}

export function introState(elapsedMs: number, lengthMs: number): IntroState {
  const t = Math.max(0, elapsedMs) * (FULL_INTRO_MS / lengthMs);
  if (t >= FULL_INTRO_MS)
    return {
      phase: "done",
      toCloud: 1,
      split: 1,
      converge: 1,
      flight: 1,
      release: 1,
      done: true,
    };
  // Progress through the phase starting at `from` and ending at `to`.
  const span = (from: number, to: number) =>
    Math.min(1, Math.max(0, (t - from) / (to - from)));
  let phase: IntroPhase = "lift";
  for (const [name, start] of STARTS) if (t >= start) phase = name;
  return {
    phase,
    toCloud:
      t < 800
        ? 0.6 * easeInOutCubic(span(0, 800))
        : 0.6 + 0.4 * easeInOutCubic(span(800, 1400)),
    split: span(1400, 2000),
    converge: CONDENSE * easeInOutCubic(span(2000, 2250)),
    flight: span(2250, 2700) ** 3,
    release: easeInOutCubic(span(2700, 3000)),
    done: false,
  };
}
