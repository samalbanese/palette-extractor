import { describe, expect, it } from "vitest";
import { srgbToOklab, oklabCoords, oklabDistance } from "./oklab.js";
import type { Pixel } from "./medianCut.js";

function closeTo(value: number, expected: number, epsilon = 1e-3) {
  expect(Math.abs(value - expected)).toBeLessThan(epsilon);
}

describe("srgbToOklab", () => {
  it("matches the published reference values for white, black, and the primaries", () => {
    const white = srgbToOklab({ r: 255, g: 255, b: 255 });
    closeTo(white.L, 1);
    closeTo(white.a, 0);
    closeTo(white.b, 0);

    const black = srgbToOklab({ r: 0, g: 0, b: 0 });
    closeTo(black.L, 0);
    closeTo(black.a, 0);
    closeTo(black.b, 0);

    const red = srgbToOklab({ r: 255, g: 0, b: 0 });
    closeTo(red.L, 0.62796);
    closeTo(red.a, 0.22486);
    closeTo(red.b, 0.12585);

    const green = srgbToOklab({ r: 0, g: 255, b: 0 });
    closeTo(green.L, 0.86644);
    closeTo(green.a, -0.23389);
    closeTo(green.b, 0.1795);

    const blue = srgbToOklab({ r: 0, g: 0, b: 255 });
    closeTo(blue.L, 0.45201);
    closeTo(blue.a, -0.03246);
    closeTo(blue.b, -0.31153);
  });
});

describe("oklabCoords", () => {
  it("stays within 0-255 for the 8 RGB cube corners", () => {
    const corners: Pixel[] = [];
    for (const r of [0, 255]) {
      for (const g of [0, 255]) {
        for (const b of [0, 255]) {
          corners.push([r, g, b]);
        }
      }
    }
    for (const corner of corners) {
      const [L, a, b] = oklabCoords(corner);
      expect(L).toBeGreaterThanOrEqual(0);
      expect(L).toBeLessThanOrEqual(255);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it("stays within 0-255 across a 16-step grid over the whole RGB cube", () => {
    const steps = Array.from({ length: 16 }, (_, i) =>
      Math.round((i * 255) / 15),
    );
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const [L, a, bb] = oklabCoords([r, g, b]);
          expect(L).toBeGreaterThanOrEqual(0);
          expect(L).toBeLessThanOrEqual(255);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(255);
          expect(bb).toBeGreaterThanOrEqual(0);
          expect(bb).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe("oklabDistance", () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };

  it("is zero for identical colors and symmetric", () => {
    const sky = { r: 95, g: 146, b: 173 };
    expect(oklabDistance(sky, sky)).toBe(0);
    expect(oklabDistance(sky, white)).toBe(oklabDistance(white, sky));
  });

  it("spans 1 from black to white", () => {
    closeTo(oklabDistance(black, white), 1);
  });

  it("keeps a one-step hex nudge well under a visible difference", () => {
    // #5f92ad and #6193ae: the same sky blue picked from neighboring pixels.
    const nudge = oklabDistance(
      { r: 95, g: 146, b: 173 },
      { r: 97, g: 147, b: 174 },
    );
    expect(nudge).toBeLessThan(0.01);
    // A sandy clay against a dark rust reads as a clearly different color.
    expect(
      oklabDistance({ r: 141, g: 110, b: 85 }, { r: 111, g: 66, b: 34 }),
    ).toBeGreaterThan(0.05);
  });
});
