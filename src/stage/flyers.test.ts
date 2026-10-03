import { describe, expect, it } from "vitest";
import { flightPath, flightTime } from "./flyers";

describe("flightPath", () => {
  const from = { x: 50, y: 80 },
    to = { x: 400, y: 260, width: 120, height: 90 };
  const path = flightPath(from, to);
  const values = (frame: Keyframe) =>
    String(frame.transform)
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
  it("starts centered on the origin as a ten pixel chip", () => {
    const [x, y, sx, sy] = values(path[0]);
    expect(x + to.width / 2).toBe(from.x);
    expect(y + to.height / 2).toBe(from.y);
    expect(sx * to.width).toBeCloseTo(10);
    expect(sy * to.height).toBeCloseTo(10);
  });
  it("ends at the destination rectangle", () => {
    expect(values(path[path.length - 1])).toEqual([400, 260, 1, 1]);
  });
  it("moves forward and grows monotonically along an arc", () => {
    path.slice(1).forEach((frame, i) => {
      expect(frame.offset).toBeGreaterThan(path[i].offset!);
      const next = values(frame),
        prior = values(path[i]);
      expect(next[0]).toBeGreaterThan(prior[0]);
      expect(next[2]).toBeGreaterThan(prior[2]);
      expect(next[3]).toBeGreaterThan(prior[3]);
    });
    expect(values(path[10])[1] + to.height / 2).toBeLessThan(
      (from.y + to.y + to.height / 2) / 2,
    );
  });
});

describe("flightTime", () => {
  it("lands the chips one after another, the last at the full duration", () => {
    const times = Array.from({ length: 6 }, (_, i) => flightTime(i, 6, 450));
    times.slice(1).forEach((time, i) => expect(time).toBeGreaterThan(times[i]));
    expect(times[5]).toBe(450);
    expect(times[5] - times[0]).toBeGreaterThanOrEqual(100);
  });
  it("gives a lone chip the whole flight", () => {
    expect(flightTime(0, 1, 450)).toBe(450);
  });
  it("never asks for a flight shorter than a millisecond", () => {
    expect(flightTime(0, 6, 1)).toBeGreaterThanOrEqual(1);
  });
});
