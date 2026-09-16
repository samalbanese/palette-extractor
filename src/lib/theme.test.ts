import { describe, expect, it } from "vitest";
import { suggestRoles } from "./theme";

describe("palette role suggestions", () => {
  it("selects the strongest contrast pair and uses only source colors", () => {
    const dark = { r: 0, g: 0, b: 0 },
      light = { r: 255, g: 255, b: 255 },
      accent = { r: 230, g: 80, b: 40 };
    const roles = suggestRoles([accent, dark, light])!;
    expect(roles.background).toEqual(light);
    expect(roles.foreground).toEqual(dark);
    expect(roles.accent).toEqual(accent);
    expect(roles.ratio).toBe(21);
  });
  it("does not fabricate contrast for monochrome palettes", () => {
    const gray = { r: 120, g: 120, b: 120 };
    expect(suggestRoles([gray])?.ratio).toBe(1);
    expect(suggestRoles([gray])?.background).toEqual(gray);
  });
  it("handles empty and low-contrast palettes without claiming a pass", () => {
    expect(suggestRoles([])).toBeNull();
    expect(
      suggestRoles([
        { r: 120, g: 120, b: 120 },
        { r: 125, g: 125, b: 125 },
      ])!.ratio,
    ).toBeLessThan(4.5);
  });
});
