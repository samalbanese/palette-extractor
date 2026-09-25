import { describe, expect, it } from "vitest";
import {
  medianCut,
  medianCutTrace,
  medianCutWeighted,
  type Pixel,
} from "./medianCut.js";
import { srgbToOklab } from "./oklab.js";
import recorded from "./__fixtures__/median-cut-rgb.json";

/** Squared Euclidean distance in RGB space, for test assertions only. */
function distSq(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

/** Build a cluster of n pixels tightly scattered around a center color. */
function cluster(
  center: [number, number, number],
  n: number,
  spread = 6,
): Pixel[] {
  const pixels: Pixel[] = [];
  for (let i = 0; i < n; i++) {
    const jitter = (channel: number) =>
      Math.min(255, Math.max(0, channel + ((i * 7) % (spread * 2)) - spread));
    pixels.push([jitter(center[0]), jitter(center[1]), jitter(center[2])]);
  }
  return pixels;
}

const near = (
  a: { r: number; g: number; b: number },
  c: [number, number, number],
) => distSq(a, { r: c[0], g: c[1], b: c[2] }) < 20 ** 2;

describe("medianCut", () => {
  it("returns a source color instead of an off-image average for one mixed box", () => {
    const red: Pixel = [250, 10, 10];
    const blue: Pixel = [10, 10, 250];
    const pixels = [
      ...Array.from({ length: 20 }, () => red),
      ...Array.from({ length: 20 }, () => blue),
    ];

    const [color] = medianCut(pixels, 1);

    expect([red, blue]).toContainEqual([color.r, color.g, color.b]);
    expect(color).toEqual({ r: red[0], g: red[1], b: red[2] });
    expect(color).not.toEqual({ r: 130, g: 10, b: 130 });
  });

  it("returns only colors present in a mixed source pixel set", () => {
    const pixels: Pixel[] = [
      ...cluster([230, 25, 35], 17, 5),
      ...cluster([30, 210, 80], 13, 7),
      ...cluster([45, 65, 225], 11, 4),
      ...cluster([235, 205, 30], 9, 6),
    ];
    const sourceColors = new Set(pixels.map((pixel) => pixel.join(",")));

    for (const count of [1, 3, 8]) {
      const palette = medianCut(pixels, count);
      for (const { r, g, b } of palette) {
        expect(sourceColors.has(`${r},${g},${b}`)).toBe(true);
      }
    }
  });

  it("recovers well-separated color clusters", () => {
    const red: [number, number, number] = [200, 30, 30];
    const green: [number, number, number] = [30, 200, 30];
    const blue: [number, number, number] = [30, 30, 200];
    const pixels = [
      ...cluster(red, 500),
      ...cluster(green, 300),
      ...cluster(blue, 200),
    ];
    const palette = medianCut(pixels, 3);
    expect(palette).toHaveLength(3);
    expect(palette.some((c) => near(c, red))).toBe(true);
    expect(palette.some((c) => near(c, green))).toBe(true);
    expect(palette.some((c) => near(c, blue))).toBe(true);
  });

  it("orders results by population (dominant color first)", () => {
    const pixels = [
      ...cluster([240, 240, 240], 900),
      ...cluster([20, 20, 20], 100),
    ];
    const palette = medianCut(pixels, 2);
    expect(palette[0].r).toBeGreaterThan(200); // the dominant light cluster leads
  });

  it("returns at most the requested count, all distinct", () => {
    const pixels = [
      ...cluster([200, 30, 30], 100),
      ...cluster([30, 200, 30], 100),
      ...cluster([30, 30, 200], 100),
      ...cluster([220, 220, 40], 100),
    ];
    for (const count of [4, 6, 10]) {
      const palette = medianCut(pixels, count);
      expect(palette.length).toBeLessThanOrEqual(count);
      const keys = palette.map((c) => `${c.r},${c.g},${c.b}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("handles a single-color image without infinite looping", () => {
    const pixels: Pixel[] = Array.from({ length: 50 }, () => [120, 60, 180]);
    expect(medianCut(pixels, 6)).toEqual([{ r: 120, g: 60, b: 180 }]);
  });

  it("handles empty input and zero count", () => {
    expect(medianCut([], 6)).toEqual([]);
    expect(medianCut([[1, 2, 3]], 0)).toEqual([]);
  });

  it("finds a small accent cluster among a dominant background", () => {
    // 95% near-white background, 5% saturated red accent.
    const pixels = [
      ...cluster([245, 244, 240], 1900, 4),
      ...cluster([210, 40, 50], 100, 4),
    ];
    const palette = medianCut(pixels, 5);
    expect(palette.some((c) => near(c, [210, 40, 50]))).toBe(true);
  });

  it("does not mutate the input array", () => {
    const pixels = [
      ...cluster([200, 30, 30], 50),
      ...cluster([30, 30, 200], 50),
    ];
    const copy = pixels.map((p) => [...p]);
    medianCut(pixels, 4);
    expect(pixels.map((p) => [...p])).toEqual(copy);
  });
});

describe("weighted median cut and trace", () => {
  it("preserves population totals, ordering, and the final split state", () => {
    const pixels = [
      ...cluster([220, 30, 30], 500),
      ...cluster([30, 190, 70], 300),
      ...cluster([40, 70, 220], 200),
    ];
    const weighted = medianCutWeighted(pixels, 3);
    expect(weighted.reduce((sum, entry) => sum + entry.population, 0)).toBe(
      pixels.length,
    );
    expect(weighted.map((entry) => entry.population)).toEqual(
      [...weighted].map((entry) => entry.population).sort((a, b) => b - a),
    );

    const traced = medianCutTrace(pixels, 3);
    expect(traced.steps[0]).toHaveLength(1);
    expect(traced.steps[traced.steps.length - 1]).toHaveLength(
      traced.result.length,
    );
    const sourceColors = new Set(pixels.map((pixel) => pixel.join(",")));
    for (const step of traced.steps) {
      for (const { color } of step) {
        expect(sourceColors.has(`${color.r},${color.g},${color.b}`)).toBe(true);
      }
    }
    expect(traced.result).toEqual(weighted);
  });

  it("sums populations when final boxes average to an identical color", () => {
    const pixels: Pixel[] = [
      [0, 0, 0],
      [0, 0, 2],
      [0, 2, 0],
      [0, 2, 2],
    ];
    const result = medianCutWeighted(pixels, 4);
    expect(result.reduce((sum, entry) => sum + entry.population, 0)).toBe(4);
  });
});

/** Deterministic PRNG so the random fixture set can be rebuilt exactly. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPixels(seed: number, n: number): Pixel[] {
  const rand = mulberry32(seed);
  return Array.from(
    { length: n },
    () =>
      [
        Math.floor(rand() * 256),
        Math.floor(rand() * 256),
        Math.floor(rand() * 256),
      ] as Pixel,
  );
}

// The same pixel sets used to record src/lib/__fixtures__/median-cut-rgb.json
// before OKLab mode was added, rebuilt here so the fixture can be checked
// against the live implementation.
const fixtureCases: Record<string, Pixel[]> = {
  mixedClusters: [
    ...cluster([230, 25, 35], 17, 5),
    ...cluster([30, 210, 80], 13, 7),
    ...cluster([45, 65, 225], 11, 4),
    ...cluster([235, 205, 30], 9, 6),
  ],
  separatedClusters: [
    ...cluster([200, 30, 30], 500),
    ...cluster([30, 200, 30], 300),
    ...cluster([30, 30, 200], 200),
  ],
  singleColor: Array.from({ length: 50 }, () => [120, 60, 180] as Pixel),
  accentCluster: [
    ...cluster([245, 244, 240], 1900, 4),
    ...cluster([210, 40, 50], 100, 4),
  ],
  random5000: randomPixels(20260925, 5000),
};

const fixture: Record<string, Record<string, unknown>> = recorded;

describe("rgb mode stays identical to the pre-oklab implementation", () => {
  it("matches an explicit rgb colorSpace option", () => {
    for (const pixels of Object.values(fixtureCases)) {
      for (const count of [1, 4, 6, 10]) {
        expect(medianCutTrace(pixels, count)).toEqual(
          medianCutTrace(pixels, count, { colorSpace: "rgb" }),
        );
      }
    }
  });

  it("reproduces the fixture recorded before OKLab mode was added", () => {
    for (const [name, pixels] of Object.entries(fixtureCases)) {
      for (const count of [1, 4, 6, 10]) {
        expect(medianCutTrace(pixels, count)).toEqual(fixture[name][count]);
      }
    }
  });
});

describe("oklab mode", () => {
  it("returns only colors present in a mixed source pixel set", () => {
    const pixels = fixtureCases.mixedClusters;
    const sourceColors = new Set(pixels.map((pixel) => pixel.join(",")));

    for (const count of [1, 3, 8]) {
      const palette = medianCut(pixels, count, { colorSpace: "oklab" });
      for (const { r, g, b } of palette) {
        expect(sourceColors.has(`${r},${g},${b}`)).toBe(true);
      }
    }
  });

  // Three greens, two swatches. The medium and bright greens are only 40
  // apart in RGB but clearly different to the eye (OKLab distance 0.122).
  // The bright green and the yellow-green are 50 apart in RGB yet nearly
  // indistinguishable (OKLab distance 0.016, close to the smallest step
  // people notice). RGB spends a swatch on the near-duplicate; OKLab spends
  // it on the difference a viewer can actually see.
  it("groups the colors that look alike rather than the ones with close RGB values", () => {
    const medium: Pixel = [0, 120, 0];
    const bright: Pixel = [0, 160, 0];
    const yellowGreen: Pixel = [50, 160, 0];
    const oklabDistance = (p: Pixel, q: Pixel) => {
      const a = srgbToOklab({ r: p[0], g: p[1], b: p[2] });
      const b = srgbToOklab({ r: q[0], g: q[1], b: q[2] });
      return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
    };
    const rgbDistance = (p: Pixel, q: Pixel) =>
      Math.sqrt(
        distSq({ r: p[0], g: p[1], b: p[2] }, { r: q[0], g: q[1], b: q[2] }),
      );
    // The premise: RGB and OKLab disagree about which pair is closer.
    expect(rgbDistance(medium, bright)).toBeLessThan(
      rgbDistance(bright, yellowGreen),
    );
    expect(oklabDistance(medium, bright)).toBeGreaterThan(
      5 * oklabDistance(bright, yellowGreen),
    );

    const pixels = [
      ...cluster(medium, 40, 3),
      ...cluster(bright, 40, 3),
      ...cluster(yellowGreen, 40, 3),
    ];
    // Whichever cluster ends up alone in its own box is the one the color
    // space considers most different from the other two.
    const loner = (colorSpace: "rgb" | "oklab") => {
      const result = medianCutWeighted(pixels, 2, { colorSpace });
      expect(result.map((entry) => entry.population)).toEqual([80, 40]);
      return result[1].color;
    };

    expect(near(loner("rgb"), yellowGreen)).toBe(true);
    expect(near(loner("oklab"), medium)).toBe(true);
  });

  it("returns an empty palette for empty input", () => {
    expect(medianCut([], 6, { colorSpace: "oklab" })).toEqual([]);
  });

  it("returns a single color for count 1", () => {
    const pixels = [
      ...cluster([200, 30, 30], 50),
      ...cluster([30, 30, 200], 50),
    ];
    expect(medianCut(pixels, 1, { colorSpace: "oklab" })).toHaveLength(1);
  });

  it("handles an all-identical pixel set without infinite looping", () => {
    const pixels: Pixel[] = Array.from({ length: 40 }, () => [90, 140, 60]);
    expect(medianCut(pixels, 6, { colorSpace: "oklab" })).toEqual([
      { r: 90, g: 140, b: 60 },
    ]);
  });

  it("returns fewer colors than requested when the image has fewer unique colors", () => {
    const pixels: Pixel[] = [
      [10, 10, 10],
      [10, 10, 10],
      [200, 200, 200],
    ];
    const palette = medianCut(pixels, 8, { colorSpace: "oklab" });
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.length).toBeLessThan(8);
  });
});
