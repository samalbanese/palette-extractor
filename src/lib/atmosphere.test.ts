import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type RGB } from "./color";
import { contrastRatio } from "./contrast";
import {
  ATMOSPHERE_CMAX,
  ATMOSPHERE_OPACITY,
  atmosphereCeiling,
  atmosphereColor,
  atmosphereColors,
} from "./atmosphere";

// Every text color and outline that the browser walk found sitting on the
// glow, across every state it visits (tests/a11y.spec.ts keeps this current).
const fixture = JSON.parse(
  readFileSync(
    new URL("../../tests/fixtures/atmosphere-text.json", import.meta.url),
    "utf8",
  ),
) as {
  text: {
    element: string;
    ink: string;
    layers: { background: string | null; opacity: number }[];
  }[];
  nonText: { element: string; color: string; alpha: number }[];
};

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const pageHex = css.match(/:root\s*{[^}]*?background:\s*(#[0-9a-f]{6})/)![1];
const page: RGB = {
  r: parseInt(pageHex.slice(1, 3), 16),
  g: parseInt(pageHex.slice(3, 5), 16),
  b: parseInt(pageHex.slice(5, 7), 16),
};
const pageMax = Math.max(page.r, page.g, page.b);
// The brightest gray the glow can make, plus two levels for gradient
// dithering and 8-bit rounding.
const worst = Math.ceil(atmosphereCeiling(pageMax)) + 2;
const gray: RGB = { r: worst, g: worst, b: worst };

type Premultiplied = { r: number; g: number; b: number; a: number };
const parse = (color: string): Premultiplied => {
  const [r, g, b, a = 1] = color.match(/[\d.]+/g)!.map(Number);
  return { r: r * a, g: g * a, b: b * a, a };
};
const clear: Premultiplied = { r: 0, g: 0, b: 0, a: 0 };
const over = (top: Premultiplied, under: Premultiplied): Premultiplied => ({
  r: top.r + under.r * (1 - top.a),
  g: top.g + under.g * (1 - top.a),
  b: top.b + under.b * (1 - top.a),
  a: top.a + under.a * (1 - top.a),
});
const fade = (p: Premultiplied, opacity: number): Premultiplied => ({
  r: p.r * opacity,
  g: p.g * opacity,
  b: p.b * opacity,
  a: p.a * opacity,
});
const onto = (p: Premultiplied, base: RGB): RGB => ({
  r: Math.round(p.r + base.r * (1 - p.a)),
  g: Math.round(p.g + base.g * (1 - p.a)),
  b: Math.round(p.b + base.b * (1 - p.a)),
});

/**
 * The ink and the surface right beside it, as drawn over `base`. Each layer
 * is an element between the text and the page: its background sits under
 * everything inside it, and its opacity fades all of it together.
 */
function render(entry: (typeof fixture.text)[number], base: RGB) {
  let ink = parse(entry.ink);
  let surface = clear;
  for (const layer of entry.layers) {
    const background = layer.background ? parse(layer.background) : clear;
    ink = fade(over(ink, background), layer.opacity);
    surface = fade(over(surface, background), layer.opacity);
  }
  return { ink: onto(ink, base), surface: onto(surface, base) };
}

describe("atmosphere contrast", () => {
  it("bounds the glow at the gray the fixture is checked against", () => {
    expect(pageMax).toBe(21);
    expect(worst).toBe(57);
  });

  it("covers the text the walk found on the glow", () => {
    expect(fixture.text.length).toBeGreaterThanOrEqual(10);
    expect(fixture.nonText.length).toBeGreaterThan(0);
  });

  it.each(fixture.text.map((entry) => [entry.element, entry] as const))(
    "%s keeps 4.5:1 over the brightest glow",
    (_, entry) => {
      const { ink, surface } = render(entry, gray);
      expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(
    fixture.nonText.map(
      (entry) => [`${entry.element} ${entry.color}`, entry] as const,
    ),
  )("the %s outline keeps 3:1 over the brightest glow", (_, entry) => {
    const outline = onto(fade(parse(entry.color), entry.alpha), gray);
    expect(contrastRatio(outline, gray)).toBeGreaterThanOrEqual(3);
  });

  it("would fail text darker than the lifted gray", () => {
    const darker = { element: "", ink: "rgb(137, 140, 142)", layers: [] };
    const { ink, surface } = render(darker, gray);
    expect(contrastRatio(ink, surface)).toBeLessThan(4.5);
  });
});

describe("atmosphereColor", () => {
  const levels = Array.from({ length: 64 }, (_, i) =>
    Math.round((i * 255) / 63),
  );

  it("never returns a channel above the cap, and leaves colors within it alone", () => {
    expect(levels[0]).toBe(0);
    expect(levels[63]).toBe(255);
    let checked = 0;
    const wrong: string[] = [];
    for (const r of levels)
      for (const g of levels)
        for (const b of levels) {
          const out = atmosphereColor({ r, g, b });
          const brightest = Math.max(out.r, out.g, out.b);
          const within = Math.max(r, g, b) <= ATMOSPHERE_CMAX;
          if (
            brightest > ATMOSPHERE_CMAX ||
            (within && (out.r !== r || out.g !== g || out.b !== b)) ||
            (!within && brightest !== ATMOSPHERE_CMAX)
          )
            wrong.push(`${r},${g},${b} -> ${out.r},${out.g},${out.b}`);
          checked++;
        }
    expect(wrong).toEqual([]);
    expect(checked).toBe(262_144);
  });

  it("keeps the hue when it scales a color down", () => {
    expect(atmosphereColor({ r: 255, g: 128, b: 0 })).toEqual({
      r: 134,
      g: 67,
      b: 0,
    });
  });
});

describe("atmosphereColors", () => {
  const entry = (hex: number, population: number) => ({
    color: { r: hex, g: hex, b: hex },
    population,
  });

  it("takes the four most populous colors, ties in palette order", () => {
    const palette = [
      entry(10, 1),
      entry(20, 5),
      entry(30, 1),
      entry(40, 5),
      entry(50, 9),
      entry(60, 1),
    ];
    expect(atmosphereColors(palette).map((c) => c.r)).toEqual([50, 20, 40, 10]);
  });

  it("repeats a small palette's colors to keep three blobs", () => {
    expect(atmosphereColors([entry(10, 1)]).map((c) => c.r)).toEqual([
      10, 10, 10,
    ]);
    expect(
      atmosphereColors([entry(10, 1), entry(20, 1)]).map((c) => c.r),
    ).toEqual([10, 20, 10]);
    expect(atmosphereColors([])).toEqual([]);
  });

  it("caps every color it returns", () => {
    expect(atmosphereColors([entry(255, 1)])[0]).toEqual({
      r: ATMOSPHERE_CMAX,
      g: ATMOSPHERE_CMAX,
      b: ATMOSPHERE_CMAX,
    });
  });

  it("sits inside the bound the contrast proof assumes", () => {
    expect(ATMOSPHERE_OPACITY).toBeGreaterThan(0);
    expect(atmosphereCeiling(21)).toBeCloseTo(54.9, 6);
  });
});
