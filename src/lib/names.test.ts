import { describe, expect, it } from "vitest";
import { COLOR_NAME_TABLE, nearestColorName, paletteColorNames } from "./names";

function fromHex(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

describe("nearestColorName", () => {
  it("gives sensible names to primary colors and common neutrals", () => {
    expect(nearestColorName({ r: 255, g: 0, b: 0 })).toBe("Red");
    expect(nearestColorName({ r: 0, g: 255, b: 0 })).toBe("Green");
    expect(nearestColorName({ r: 0, g: 0, b: 255 })).toBe("Blue");
    expect(nearestColorName({ r: 0, g: 0, b: 0 })).toBe("Black");
    expect(nearestColorName({ r: 255, g: 255, b: 255 })).toBe("White");
    expect(nearestColorName({ r: 128, g: 128, b: 128 })).toBe("Mid Gray");
  });

  it("covers the color space with a curated table whose entries map to themselves", () => {
    expect(COLOR_NAME_TABLE.length).toBeGreaterThanOrEqual(120);
    expect(COLOR_NAME_TABLE.length).toBeLessThanOrEqual(160);
    for (const entry of COLOR_NAME_TABLE) {
      expect(nearestColorName(fromHex(entry.hex))).toBe(entry.name);
    }
  });

  it("never throws for varied RGB values", () => {
    for (let index = 0; index < 500; index++) {
      const rgb = {
        r: (index * 47) % 256,
        g: (index * 89) % 256,
        b: (index * 137) % 256,
      };
      expect(() => nearestColorName(rgb)).not.toThrow();
    }
  });
});

describe("paletteColorNames", () => {
  // The Forest floor sample at six colors: six close, dark greens.
  const forest = [
    "#17251e",
    "#233531",
    "#29403a",
    "#30514a",
    "#337265",
    "#2c3731",
  ].map(fromHex);

  it("never repeats a name within a palette", () => {
    const names = paletteColorNames(forest);
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });

  it("keeps each color's nearest name when nothing repeats", () => {
    const dunes = [
      "#5f92ad",
      "#352114",
      "#d27108",
      "#84afbd",
      "#975112",
      "#7a7769",
    ].map(fromHex);
    expect(paletteColorNames(dunes)).toEqual(dunes.map(nearestColorName));
    expect(paletteColorNames(dunes)).toEqual([
      "Blue Gray",
      "Espresso",
      "Amber",
      "Seafoam",
      "Rust",
      "Taupe",
    ]);
  });

  it("gives a repeated name to the closest color and the next unused name to the other", () => {
    // Two greens that are both nearest to Pine (#244d3d); the first is closer.
    const pair = ["#254e3e", "#2a5242"].map(fromHex);
    expect(pair.map(nearestColorName)).toEqual(["Pine", "Pine"]);
    const names = paletteColorNames(pair);
    expect(names[0]).toBe("Pine");
    expect(names[1]).not.toBe("Pine");
    for (const [index, name] of names.entries()) {
      const nearest = nearestColorName(pair[index]);
      if (name === nearest) continue;
      // Someone closer took the nearest name.
      expect(names).toContain(nearest);
    }
  });

  it("names dark forest greens as greens, not blues", () => {
    const names = paletteColorNames(forest);
    expect(names.filter((name) => /navy|blue|denim/i.test(name))).toEqual([]);
    expect(names).toEqual([
      "Black Forest",
      "Evergreen",
      "Pine",
      "Hunter Green",
      "Spruce",
      "Graphite Green",
    ]);
  });

  it("names each color the same way whatever order the palette is in", () => {
    const forward = paletteColorNames(forest);
    const reversed = paletteColorNames([...forest].reverse()).reverse();
    expect(reversed).toEqual(forward);
  });

  it("handles an empty palette and repeated colors", () => {
    expect(paletteColorNames([])).toEqual([]);
    const gray = { r: 128, g: 128, b: 128 };
    const names = paletteColorNames([gray, gray]);
    expect(names[0]).toBe("Mid Gray");
    expect(names[1]).not.toBe("Mid Gray");
  });
});
