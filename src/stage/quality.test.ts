import { describe, expect, it } from "vitest";
import { createQualityMonitor } from "./quality";

function feed(
  monitor: ReturnType<typeof createQualityMonitor>,
  ms: number,
  frames: number,
) {
  let points = 0;
  for (let i = 0; i < frames; i++) points = monitor.record(ms);
  return points;
}

describe("createQualityMonitor", () => {
  it("starts at 20,000 points and ignores the first 5 frames", () => {
    const monitor = createQualityMonitor();
    expect(monitor.points).toBe(20000);
    expect(feed(monitor, 200, 5)).toBe(20000);
    // The 29 frames after warm-up are not yet a full window.
    expect(feed(monitor, 21, 29)).toBe(20000);
    expect(monitor.record(21)).toBe(8000);
  });

  it("keeps full quality and stops measuring after a window within budget", () => {
    const monitor = createQualityMonitor();
    feed(monitor, 5, 5);
    expect(feed(monitor, 19, 30)).toBe(20000);
    expect(feed(monitor, 90, 120)).toBe(20000);
  });

  it("drops a second level only after a fresh slow window", () => {
    const monitor = createQualityMonitor();
    feed(monitor, 5, 5);
    expect(feed(monitor, 25, 30)).toBe(8000);
    expect(feed(monitor, 25, 29)).toBe(8000);
    expect(monitor.record(25)).toBe(4000);
    expect(feed(monitor, 80, 300)).toBe(4000);
  });

  it("judges a window by its median, not its worst frame", () => {
    const monitor = createQualityMonitor();
    feed(monitor, 5, 5);
    feed(monitor, 300, 14);
    expect(feed(monitor, 16, 16)).toBe(20000);
  });

  it("stops after the first fast window even if later frames are slow", () => {
    const monitor = createQualityMonitor();
    feed(monitor, 5, 5);
    expect(feed(monitor, 25, 30)).toBe(8000);
    expect(feed(monitor, 10, 30)).toBe(8000);
    expect(feed(monitor, 50, 60)).toBe(8000);
  });
});
