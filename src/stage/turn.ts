/** The slow turn the cloud makes by itself: once every 24 s, in radians a ms. */
export const AUTO_SPIN = (2 * Math.PI) / 24000;
/** How quickly a fling eases back into the slow turn: its time constant. */
const GLIDE_MS = 600;
/** The fastest a fling can spin the cloud: one turn a second. */
const MAX_SPIN = (2 * Math.PI) / 1000;
/** A hand that stopped this long before letting go leaves no fling. */
const STILL_MS = 80;
/** How far back a fling's speed is measured. */
const FLING_MS = 100;

/** The turn for a drag `dx` pixels across: half a turn for the whole width. */
export const dragTurn = (dx: number, width: number) =>
  (dx / Math.max(1, width)) * Math.PI;

/**
 * `ms` of coasting from `spin`: the spin eases toward `rest` and the turn
 * covered on the way, both exact for any frame length.
 */
export function coast(spin: number, ms: number, rest = AUTO_SPIN) {
  const left = Math.exp(-ms / GLIDE_MS);
  return {
    spin: rest + (spin - rest) * left,
    turned: rest * ms + (spin - rest) * GLIDE_MS * (1 - left),
  };
}

/**
 * The spin a hand leaves when it lets go at `now`, from its recent
 * positions as [time, total turn] pairs: its speed over the last moments,
 * none if it had stopped, never past one turn a second.
 */
export function flingSpin(moves: [number, number][], now: number) {
  const last = moves[moves.length - 1];
  if (!last || now - last[0] > STILL_MS) return 0;
  const first = moves.find(([time]) => time >= last[0] - FLING_MS) ?? last;
  // Events can share a timestamp; a frame is the shortest span counted.
  const speed = (last[1] - first[1]) / Math.max(16, last[0] - first[0]);
  return Math.max(-MAX_SPIN, Math.min(MAX_SPIN, speed));
}
