import { describe, expect, it } from "vitest";
import { COLOR_NAME_TABLE, nearestColorName } from "./names";

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
