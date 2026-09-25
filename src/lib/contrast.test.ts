import { describe, expect, it } from "vitest";
import { contrastRatio, readablePairs } from "./contrast";

const black = { r: 0, g: 0, b: 0 };
const white = { r: 255, g: 255, b: 255 };
const midGray = { r: 118, g: 118, b: 118 }; // #767676: the classic 4.5:1-on-white gray

describe("contrastRatio", () => {
  it("returns 21 for black on white and 1 for identical colors", () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5); // symmetric
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it("matches the known #767676-on-white ratio of ~4.54", () => {
    expect(contrastRatio(midGray, white)).toBeCloseTo(4.54, 2);
  });
});

describe("readablePairs (acceptance: WCAG-compliant pairs with ratios)", () => {
  it("finds pairs, sorts strongest first, and assigns correct levels", () => {
    const pairs = readablePairs([black, white, midGray]);
    expect(pairs).toHaveLength(3); // black+white, gray+white, black+gray
    expect(pairs[0].ratio).toBeCloseTo(21, 5);
    expect(pairs[0].level).toBe("AAA");
    const grayOnWhite = pairs.find((p) => p.fg === midGray);
    expect(grayOnWhite?.level).toBe("AA");
    const blackOnGray = pairs.find((p) => p.fg === black && p.bg === midGray);
    expect(blackOnGray?.ratio).toBeCloseTo(4.62, 1);
    expect(blackOnGray?.level).toBe("AA");
  });

  it("presents the lighter color as the background", () => {
    for (const pair of readablePairs([black, white, midGray])) {
      expect(contrastRatio(pair.bg, white)).toBeLessThanOrEqual(
        contrastRatio(pair.fg, white),
      );
    }
  });

  it("excludes pairs below 3:1 and handles low-contrast palettes", () => {
    const a = { r: 100, g: 100, b: 100 };
    const b = { r: 120, g: 120, b: 120 };
    expect(readablePairs([a, b])).toEqual([]);
    expect(readablePairs([])).toEqual([]);
  });
});
