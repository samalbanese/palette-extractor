import { describe, expect, it } from "vitest";
import { contrastRatio, formatRatio, readablePairs } from "./contrast";

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

const gray = (v: number) => ({ r: v, g: v, b: v });

describe("formatRatio", () => {
  it("truncates instead of rounding, so a near miss never reads as a pass", () => {
    expect(formatRatio(4.4999)).toBe("4.49");
    expect(formatRatio(6.4199)).toBe("6.41");
    expect(formatRatio(6.999)).toBe("6.99");
  });

  it("keeps exact hundredths despite floating point error", () => {
    // 4.35 * 100 is 434.99999999999994 in binary floating point.
    expect(formatRatio(4.35)).toBe("4.35");
    expect(formatRatio(4.5)).toBe("4.50");
    expect(formatRatio(1)).toBe("1.00");
    expect(formatRatio(21)).toBe("21.00");
  });

  it("never shows a number that contradicts the WCAG level, for any pair of grays", () => {
    const contradictions: string[] = [];
    for (let a = 0; a < 256; a++) {
      for (let b = a; b < 256; b++) {
        const ratio = contrastRatio(gray(a), gray(b));
        const shown = Number(formatRatio(ratio));
        if (shown >= 4.5 !== ratio >= 4.5 || shown >= 7 !== ratio >= 7)
          contradictions.push(`${a}/${b}: ${ratio} shown as ${shown}`);
      }
    }
    expect(contradictions).toEqual([]);
  });

  it("never rounds a real color pair a hair under a threshold up to it", () => {
    const rgb = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    });
    // Each pair is within 1e-11 below the threshold.
    const nearMisses: [string, string, string][] = [
      ["#c83cc1", "#1b0322", "4.49"],
      ["#2671e5", "#060201", "4.49"],
      ["#6aae58", "#05102b", "6.99"],
      ["#c0e29a", "#302ab0", "6.99"],
    ];
    for (const [fg, bg, shown] of nearMisses)
      expect(formatRatio(contrastRatio(rgb(fg), rgb(bg))), `${fg}/${bg}`).toBe(
        shown,
      );
    expect(formatRatio(4.499999999999)).toBe("4.49");
  });
});

describe("contrast ratios on screen", () => {
  const sources = import.meta.glob("../components/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("are all formatted by formatRatio", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const adHoc = Object.entries(sources)
      .filter(([, source]) =>
        /\.ratio\.toFixed\(|contrastRatio\([^)]*\)\.toFixed\(|Math\.floor\([^)]*ratio/.test(
          source,
        ),
      )
      .map(([file]) => file);
    expect(adHoc).toEqual([]);
  });
});
