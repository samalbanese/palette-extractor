const LEVELS = [20000, 8000, 4000];
const WARM_UP_FRAMES = 5;
const WINDOW_FRAMES = 30;
const FRAME_BUDGET_MS = 20;

export interface QualityMonitor {
  /** Points to draw now. */
  readonly points: number;
  /** Adds one frame's duration and returns the points to draw next. */
  record(frameMs: number): number;
}

/**
 * Lowers the point count when a window of frames runs over budget. Each
 * drop starts a fresh window; the first window within budget ends the
 * measuring, so quality never flips back and forth.
 */
export function createQualityMonitor(): QualityMonitor {
  let level = 0;
  let skipped = 0;
  let measuring = true;
  let window: number[] = [];
  return {
    get points() {
      return LEVELS[level];
    },
    record(frameMs) {
      if (!measuring) return LEVELS[level];
      if (skipped < WARM_UP_FRAMES) {
        skipped++;
        return LEVELS[level];
      }
      window.push(frameMs);
      if (window.length === WINDOW_FRAMES) {
        const median = [...window].sort((a, b) => a - b)[WINDOW_FRAMES / 2];
        window = [];
        if (median > FRAME_BUDGET_MS && level < LEVELS.length - 1) level++;
        else measuring = false;
        if (level === LEVELS.length - 1) measuring = false;
      }
      return LEVELS[level];
    },
  };
}
