import { describe, expect, it } from "vitest";
import {
  FULL_INTRO_MS,
  SHORT_INTRO_MS,
  introLength,
  introState,
} from "./timeline";

const PHASES = [
  ["lift", 0],
  ["settle", 800],
  ["split", 1400],
  ["converge", 2000],
  ["flight", 2300],
  ["release", 2700],
  ["done", 3000],
] as const;

describe("introLength", () => {
  it("plays the full intro when there is room and never less than the short one", () => {
    expect(FULL_INTRO_MS).toBe(3000);
    expect(SHORT_INTRO_MS).toBe(1200);
    expect(introLength(4000)).toBe(3000);
    expect(introLength(2000)).toBe(2000);
    expect(introLength(1999.6)).toBe(2000);
    expect(introLength(500)).toBe(1200);
    expect(introLength(-300)).toBe(1200);
  });
});

describe("introState", () => {
  it.each([3000, 1200])(
    "starts each phase exactly on its boundary at %i ms",
    (length) => {
      for (const [phase, start] of PHASES) {
        const at = (start * length) / 3000;
        expect(introState(at, length).phase).toBe(phase);
        if (start > 0)
          expect(introState(at - 0.01, length).phase).not.toBe(phase);
      }
    },
  );

  it("clamps negative elapsed time to the first frame", () => {
    expect(introState(-50, 3000)).toEqual(introState(0, 3000));
    expect(introState(0, 3000)).toMatchObject({
      phase: "lift",
      toCloud: 0,
      split: 0,
      converge: 0,
      flight: 0,
      release: 0,
      done: false,
    });
  });

  it("hands each value over at its boundary", () => {
    expect(introState(800, 3000).toCloud).toBeCloseTo(0.6, 10);
    expect(introState(1400, 3000).toCloud).toBe(1);
    expect(introState(2000, 3000).split).toBe(1);
    expect(introState(2300, 3000).converge).toBe(1);
    expect(introState(2700, 3000).flight).toBe(1);
  });

  it("only moves each value forward", () => {
    const keys = ["toCloud", "split", "converge", "flight", "release"] as const;
    for (const length of [3000, 1200, 2345]) {
      let previous = introState(0, length);
      for (let t = 1; t <= length + 100; t += 1) {
        const state = introState(t, length);
        for (const key of keys)
          expect(state[key]).toBeGreaterThanOrEqual(previous[key]);
        previous = state;
      }
    }
  });

  it("is done at and after the end with every value complete", () => {
    for (const t of [3000, 3001, 99999])
      expect(introState(t, 3000)).toEqual({
        phase: "done",
        toCloud: 1,
        split: 1,
        converge: 1,
        flight: 1,
        release: 1,
        done: true,
      });
    expect(introState(2999.9, 3000).done).toBe(false);
  });
});
