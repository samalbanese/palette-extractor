import { describe, expect, it } from "vitest";
import { NO_SWATCH, swatchForGroup, withoutBoxes } from "./stageGroups";
import type { RGB } from "./color";

const red: RGB = { r: 200, g: 30, b: 30 };
const nearRed: RGB = { r: 201, g: 30, b: 30 };
const blue: RGB = { r: 30, g: 30, b: 200 };
const sand: RGB = { r: 211, g: 154, b: 95 };

describe("swatchForGroup", () => {
  it("prefers the swatch with the same hex over a nearer-listed one", () => {
    expect([...swatchForGroup([red], [nearRed, red])]).toEqual([1]);
  });

  it("sends a color the app dropped for matching a lock to that locked swatch", () => {
    // Locked blue is shown first; the extraction also found blue and red.
    const groupColors = [blue, red, blue];
    expect([...swatchForGroup(groupColors, [blue, red])]).toEqual([0, 1, 0]);
  });

  it("falls back to the nearest swatch in OKLab when no hex matches", () => {
    expect([
      ...swatchForGroup([{ r: 250, g: 0, b: 0 }], [blue, red, sand]),
    ]).toEqual([1]);
  });

  it("follows the displayed order when the palette is re-sorted", () => {
    expect([...swatchForGroup([red, blue], [red, blue])]).toEqual([0, 1]);
    expect([...swatchForGroup([red, blue], [blue, red])]).toEqual([1, 0]);
  });

  it("returns NO_SWATCH for every group when nothing is displayed", () => {
    expect([...swatchForGroup([red, blue], [])]).toEqual([
      NO_SWATCH,
      NO_SWATCH,
    ]);
  });
});

describe("withoutBoxes", () => {
  it("keeps everything but the per-step boxes", () => {
    const samples = {
      width: 2,
      height: 1,
      positions: new Uint16Array([0, 0, 1, 0]),
      colors: new Uint8Array([1, 2, 3, 4, 5, 6]),
      groups: new Uint8Array([0, 1]),
      boxes: new Uint8Array([0, 0, 0, 1]),
      groupColors: [red, blue],
    };
    const trimmed = withoutBoxes(samples);
    expect(trimmed.boxes).toHaveLength(0);
    expect(trimmed.groups).toBe(samples.groups);
    expect(trimmed.positions).toBe(samples.positions);
  });
});
