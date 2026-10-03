import { describe, expect, it } from "vitest";
import { AUTO_SPIN, coast, dragTurn, flingSpin } from "./turn";

describe("dragTurn", () => {
  it("turns half a revolution for a drag across the whole width", () => {
    expect(dragTurn(600, 600)).toBeCloseTo(Math.PI, 12);
    expect(dragTurn(-150, 600)).toBeCloseTo(-Math.PI / 4, 12);
  });

  it("never divides by a frame with no width", () => {
    expect(Number.isFinite(dragTurn(20, 0))).toBe(true);
  });
});

describe("coast", () => {
  it("keeps the slow turn steady", () => {
    const next = coast(AUTO_SPIN, 1000);
    expect(next.spin).toBeCloseTo(AUTO_SPIN, 12);
    expect(next.turned).toBeCloseTo(AUTO_SPIN * 1000, 9);
  });

  it("eases a fling back into the slow turn, either way round", () => {
    for (const fling of [0.005, -0.005, 0]) {
      const soon = coast(fling, 200);
      expect(Math.abs(soon.spin - AUTO_SPIN)).toBeLessThan(
        Math.abs(fling - AUTO_SPIN),
      );
      expect(coast(fling, 5000).spin).toBeCloseTo(AUTO_SPIN, 5);
    }
  });

  it("covers the same turn in one long frame as in many short ones", () => {
    const whole = coast(0.004, 480);
    let spin = 0.004,
      turned = 0;
    for (let k = 0; k < 30; k++) {
      const step = coast(spin, 16);
      spin = step.spin;
      turned += step.turned;
    }
    expect(turned).toBeCloseTo(whole.turned, 9);
    expect(spin).toBeCloseTo(whole.spin, 12);
  });

  it("stops by itself with no slow turn to return to", () => {
    const next = coast(0.003, 10000, 0);
    expect(next.spin).toBeCloseTo(0, 8);
    expect(next.turned).toBeCloseTo(0.003 * 600, 3);
  });
});

describe("flingSpin", () => {
  it("measures the hand's speed over its last moments", () => {
    const moves: [number, number][] = [
      [0, 0],
      [100, 0.1],
      [150, 0.2],
      [200, 0.3],
    ];
    expect(flingSpin(moves, 210)).toBeCloseTo(0.2 / 100, 12);
  });

  it("leaves no fling when the hand stopped before letting go", () => {
    expect(
      flingSpin(
        [
          [0, 0],
          [20, 0.5],
        ],
        200,
      ),
    ).toBe(0);
    expect(flingSpin([], 10)).toBe(0);
  });

  it("caps a wild fling at a turn a second, and counts moves sharing a timestamp", () => {
    const moves: [number, number][] = [
      [50, 0],
      [50, 2],
    ];
    expect(flingSpin(moves, 52)).toBeCloseTo((2 * Math.PI) / 1000, 12);
    expect(
      flingSpin(
        [
          [50, 0],
          [50, -2],
        ],
        52,
      ),
    ).toBeCloseTo((-2 * Math.PI) / 1000, 12);
  });
});
