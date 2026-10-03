import { describe, expect, it } from "vitest";
import { srgbToOklab } from "@relaywright/median-cut";
import { type RGB } from "./color";
import {
  colorAt,
  colorChange,
  easeInOutCubic,
  mixOklab,
  planMorph,
  settledAt,
  type DisplayedSwatch,
} from "./morph";

const black = { r: 0, g: 0, b: 0 };
const white = { r: 255, g: 255, b: 255 };
const red = { r: 255, g: 0, b: 0 };
const green = { r: 0, g: 255, b: 0 };
const blue = { r: 0, g: 0, b: 255 };
const cyan = { r: 0, g: 255, b: 255 };
const magenta = { r: 255, g: 0, b: 255 };
const yellow = { r: 255, g: 255, b: 0 };

/** Swatches at rest, named A, B, C... in slot order. */
const shown = (colors: RGB[], locked: number[] = []): DisplayedSwatch[] =>
  colors.map((rgb, i) => ({
    id: String.fromCharCode(65 + i),
    rgb,
    target: rgb,
    locked: locked.includes(i),
  }));
const palette = (colors: RGB[], locked: number[] = []) =>
  colors.map((rgb, i) => ({ rgb, locked: locked.includes(i) }));
/** What is on screen once a plan has finished. */
const after = (
  plan: ReturnType<typeof planMorph>,
  locked: number[] = [],
): DisplayedSwatch[] =>
  plan.items.map((item, i) => ({
    id: item.id,
    rgb: item.to,
    target: item.to,
    locked: locked.includes(i),
  }));
const ids = (plan: ReturnType<typeof planMorph>) =>
  plan.items.map((item) => item.id);
const noNewIds = () => {
  throw new Error("No new swatch expected");
};
const counter = (first: string) => {
  let code = first.charCodeAt(0);
  return () => String.fromCharCode(code++);
};

describe("planMorph", () => {
  it("keeps every ID through a pure sort and introduces no new targets", () => {
    const plan = planMorph(
      shown([red, blue, green, white]),
      palette([white, green, red, blue]),
      noNewIds,
    );
    expect(ids(plan)).toEqual(["D", "C", "A", "B"]);
    expect(plan.items.map((item) => item.retarget)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(plan.items.map((item) => [item.fromSlot, item.toSlot])).toEqual([
      [3, 0],
      [2, 1],
      [0, 2],
      [1, 3],
    ]);
    expect(plan.removed).toEqual([]);
  });

  it("pairs duplicates in order of occurrence", () => {
    const plan = planMorph(
      shown([red, blue, red, red]),
      palette([red, red, blue, red]),
      noNewIds,
    );
    expect(ids(plan)).toEqual(["A", "C", "B", "D"]);
  });

  it("keeps a locked color on its swatch and color when a sort moves it", () => {
    const plan = planMorph(
      shown([red, blue, green], [0]),
      palette([green, blue, red], [2]),
      noNewIds,
    );
    expect(plan.items[2]).toMatchObject({
      id: "A",
      to: red,
      retarget: false,
      fromSlot: 0,
    });
    expect(ids(plan)).toEqual(["C", "B", "A"]);
  });

  it("matches a locked color to its same-hex swatch whether or not it was locked", () => {
    // Without the lock, the first red would take A; the lock claims A first.
    for (const wasLocked of [[], [0]]) {
      const plan = planMorph(
        shown([red, red], wasLocked),
        palette([red, red], [1]),
        noNewIds,
      );
      expect(ids(plan)).toEqual(["B", "A"]);
    }
    expect(
      ids(planMorph(shown([red, red]), palette([red, red]), noNewIds)),
    ).toEqual(["A", "B"]);
  });

  it("lets a locked color with no same-hex swatch fall through to nearest matching", () => {
    const darkRed = { r: 240, g: 0, b: 0 };
    const darkBlue = { r: 0, g: 0, b: 240 };
    const plan = planMorph(
      shown([red, blue]),
      palette([darkBlue, darkRed], [0]),
      noNewIds,
    );
    expect(ids(plan)).toEqual(["B", "A"]);
    expect(plan.items.every((item) => item.retarget)).toBe(true);
  });

  it("grows six to eight keeping all six IDs, then drops the two unmatched", () => {
    // Exact: white E, blue D, green C, cyan F. Nearest: (5,5,5) to black A
    // and (250,0,0) to red B. Yellow and magenta match nothing and get G, H.
    const six = [black, red, green, blue, white, cyan];
    const nearBlack = { r: 5, g: 5, b: 5 };
    const nearRed = { r: 250, g: 0, b: 0 };
    const grown = planMorph(
      shown(six),
      palette([yellow, white, nearBlack, magenta, blue, nearRed, green, cyan]),
      counter("G"),
    );
    expect(ids(grown)).toEqual(["G", "E", "A", "H", "D", "B", "C", "F"]);
    expect(grown.items.map((item) => item.retarget)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(grown.items[0]).toMatchObject({ from: null, fromSlot: null });
    expect(grown.items[3]).toMatchObject({ from: null, fromSlot: null });
    expect(grown.removed).toEqual([]);

    const shrunk = planMorph(after(grown), palette(six), noNewIds);
    expect(ids(shrunk)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(shrunk.items.map((item) => item.retarget)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(shrunk.removed).toEqual(["G", "H"]);
  });

  it("breaks distance ties by the lower next slot, then the lower previous slot", () => {
    // Every pair is the same distance apart.
    expect(
      ids(planMorph(shown([black, black]), palette([white, white]), noNewIds)),
    ).toEqual(["A", "B"]);
    expect(
      ids(planMorph(shown([black]), palette([white, white]), counter("X"))),
    ).toEqual(["A", "X"]);
    const plan = planMorph(shown([black, black]), palette([white]), noNewIds);
    expect(ids(plan)).toEqual(["A"]);
    expect(plan.removed).toEqual(["B"]);
  });

  it("follows the worked duplicate example", () => {
    const first = planMorph(
      shown([red, red, blue]),
      palette([blue, red, red, green], [0]),
      counter("D"),
    );
    expect(ids(first)).toEqual(["C", "A", "B", "D"]);
    expect(first.items[3]).toMatchObject({ from: null, to: green });
    const second = planMorph(
      after(first, [0]),
      palette([red, blue], [0]),
      noNewIds,
    );
    expect(ids(second)).toEqual(["A", "C"]);
    expect(second.removed).toEqual(["B", "D"]);
  });

  it("matches on targets mid-melt and leaves an unchanged target's timeline alone", () => {
    // A is 200 ms into black to white; B is blue. Sorting to [blue, white].
    const melting: DisplayedSwatch[] = [
      { id: "A", rgb: { r: 99, g: 99, b: 99 }, target: white, locked: false },
      { id: "B", rgb: blue, target: blue, locked: false },
    ];
    const sorted = planMorph(melting, palette([blue, white]), noNewIds);
    expect(ids(sorted)).toEqual(["B", "A"]);
    expect(sorted.items[1]).toMatchObject({
      from: { r: 99, g: 99, b: 99 },
      to: white,
      retarget: false,
    });
    // Black is what A shows, not where it is going, so black is a new target.
    const back = planMorph(melting, palette([black, blue]), noNewIds);
    expect(ids(back)).toEqual(["A", "B"]);
    expect(back.items[0].retarget).toBe(true);
  });
});

describe("colorChange", () => {
  it("gives final colors only for a non-null photo that is a different object", () => {
    const dunes = { name: "Golden dunes" };
    const forest = { name: "Forest floor" };
    expect(colorChange(dunes, forest)).toBe("final");
    expect(colorChange(null, dunes)).toBe("final");
    expect(colorChange(dunes, dunes)).toBe("morph");
    expect(colorChange(dunes, null)).toBe("morph");
    expect(colorChange(null, null)).toBe("morph");
  });
});

describe("mixOklab", () => {
  it("returns the endpoints exactly", () => {
    expect(mixOklab(red, blue, 0)).toEqual(red);
    expect(mixOklab(red, blue, 1)).toEqual(blue);
    expect(mixOklab({ r: 12, g: 200, b: 77 }, white, 1)).toEqual(white);
  });

  it("puts the black-to-white midpoint at OKLab L 0.5", () => {
    expect(
      Math.abs(srgbToOklab(mixOklab(black, white, 0.5)).L - 0.5),
    ).toBeLessThan(0.01);
  });

  // Recorded with the CSS Color 4 sample conversion (sRGB to XYZ D65 to
  // OKLab and back), clipped in linear sRGB. Green to blue passes outside
  // sRGB, so it exercises the clip.
  const references: [string, RGB, number[][]][] = [
    [
      "red to blue",
      red,
      [
        [198, 73, 109],
        [140, 83, 162],
        [81, 71, 210],
      ],
    ],
    [
      "green to blue",
      green,
      [
        [0, 214, 141],
        [0, 170, 191],
        [0, 117, 226],
      ],
    ],
  ];
  for (const [name, start, expected] of references)
    it(`matches the reference ${name} at 0.25, 0.5 and 0.75`, () => {
      [0.25, 0.5, 0.75].forEach((t, i) => {
        const { r, g, b } = mixOklab(start, blue, t);
        [r, g, b].forEach((channel, c) => {
          expect(Number.isInteger(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
          expect(Math.abs(channel - expected[i][c])).toBeLessThanOrEqual(1);
        });
      });
    });

  it("keeps every channel an integer within 0..255", () => {
    const corners = [black, white, red, green, blue, cyan, magenta, yellow];
    for (const a of corners)
      for (const b of corners)
        for (let t = 0; t <= 1; t += 0.05)
          for (const channel of Object.values(mixOklab(a, b, t))) {
            expect(Number.isInteger(channel)).toBe(true);
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(255);
          }
  });
});

describe("colorAt", () => {
  it("eases over 400 ms and holds the target afterward", () => {
    const melt = { from: black, to: white, start: 1000 };
    expect(colorAt(melt, 1000)).toEqual(black);
    expect(colorAt(melt, 1100)).toEqual(
      mixOklab(black, white, easeInOutCubic(0.25)),
    );
    // Eased, not linear: a quarter of the way in shows far less than a
    // quarter of the change.
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625);
    expect(colorAt(melt, 1400)).toEqual(white);
    expect(colorAt(melt, 9999)).toEqual(white);
    expect(colorAt(settledAt(red), 0)).toEqual(red);
  });
});
