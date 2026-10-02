import { test, expect, type Page } from "@playwright/test";
import { rgbToHex } from "../src/lib/color";
import {
  ATMOSPHERE_OPACITY,
  atmosphereCeiling,
  atmosphereColor,
  atmosphereColors,
} from "../src/lib/atmosphere";
import { ready, settled } from "./helpers";
import { hexToRgb, setHash } from "./morph-checks";
import {
  fadeTo,
  finishFades,
  glow,
  holdFades,
  layers,
  nothingVisible,
  onlyAtmosphere,
  pixels,
} from "./atmosphere-checks";

const PAGE = { r: 0x11, g: 0x13, b: 0x15 };
// The brightest any channel may render, with two levels for dithering.
const CEILING =
  Math.ceil(atmosphereCeiling(Math.max(PAGE.r, PAGE.g, PAGE.b))) + 2;

// Bright, saturated shared palettes: every color is well over the cap.
const P0 = "ffffff.ffff00.00ffff.ff00ff";
const P1 = "ff0000.00ff00.0000ff.ffffff";
const P2 = "808080.ff8000.0080ff";
const P3 = "f0f0f0.e0c0a0.a0c0e0.ffffff";

/** The glow colors a shared palette should get. */
const expected = (palette: string) =>
  atmosphereColors(
    palette
      .split(".")
      .map((hex) => ({ color: hexToRgb(`#${hex}`), population: 1 })),
  )
    .map(rgbToHex)
    .join(",");

const hexes = (page: Page) =>
  page
    .locator(".swatch-select")
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute("aria-label")!.match(/#[0-9a-f]{6}/)![0])
        .join("."),
    );

/** Opens a shared palette and waits until the swatches show it. */
async function showShared(page: Page, palette: string, first = false) {
  const want = palette
    .split(".")
    .map((hex) => `#${hex}`)
    .join(".");
  if (first) await page.goto(`/#p=${palette}`);
  else await setHash(page, `#p=${palette}`);
  await expect.poll(() => hexes(page)).toBe(want);
}

/** The brightest channel anywhere on the page, with only the glow showing. */
async function brightest(page: Page) {
  const shot = await pixels(page, page.context(), { fullPage: true });
  let max = 0;
  for (let i = 0; i < shot.data.length; i += 4)
    max = Math.max(max, shot.data[i], shot.data[i + 1], shot.data[i + 2]);
  return max;
}

/** Every layer stacks with plain blending, and their opacities stay within A. */
async function expectPlainBlending(page: Page) {
  const state = await glow(page);
  expect(state.ancestors).toEqual([]);
  expect(state.container).toBe("1");
  for (const layer of state.layers) {
    expect(layer.blend).toBe("normal");
    expect(layer.backdrop).toBe("none");
    for (const blob of layer.blobs) {
      expect(blob).toMatchObject({
        opacity: "1",
        blend: "normal",
        backdrop: "none",
        filter: "none",
      });
      expect(blob.image).toMatch(/^radial-gradient/);
    }
  }
  const sum = state.layers.reduce((total, layer) => total + layer.opacity, 0);
  expect(sum).toBeLessThanOrEqual(ATMOSPHERE_OPACITY + 0.001);
  return state;
}

/** Counts glow layers after every change to the glow, from page load on. */
async function watchLayers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __mostLayers: number };
    w.__mostLayers = 0;
    new MutationObserver(() => {
      w.__mostLayers = Math.max(
        w.__mostLayers,
        document.querySelectorAll(".atmosphere-layer").length,
      );
    }).observe(document, { childList: true, subtree: true });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __mostLayers: number }).__mostLayers,
    );
}

test("the glow is decorative and takes no space", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await ready(page);
    const atmosphere = page.locator(".atmosphere");
    await expect(atmosphere).toHaveAttribute("aria-hidden", "true");
    expect(
      await atmosphere.evaluate((el) => ({
        pointer: getComputedStyle(el).pointerEvents,
        position: getComputedStyle(el).position,
        zIndex: getComputedStyle(el).zIndex,
        // The glow never widens the page.
        fits: document.documentElement.scrollWidth <= innerWidth,
      })),
    ).toEqual({
      pointer: "none",
      position: "absolute",
      zIndex: "-1",
      fits: true,
    });
    await expect(layers(page)).toHaveCount(1);
  }
});

test("at rest on Golden dunes the glow is visible and stays under the bound", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await ready(page);
  await settled(page);
  const state = await expectPlainBlending(page);
  expect(state.layers).toHaveLength(1);
  expect(state.layers[0].opacity).toBe(ATMOSPHERE_OPACITY);

  // Drawn from the palette's own colors, each within the cap.
  const swatches = (await hexes(page)).split(".");
  const glowColors = state.layers[0].colors.split(",");
  expect(glowColors).toHaveLength(4);
  for (const color of glowColors)
    expect(
      swatches.map((hex) => rgbToHex(atmosphereColor(hexToRgb(hex)))),
    ).toContain(color);

  await onlyAtmosphere(page);
  expect(await brightest(page)).toBeLessThanOrEqual(CEILING);
  const shot = await pixels(page, page.context());
  let lit = 0;
  for (let i = 0; i < shot.data.length; i += 4)
    if (
      Math.abs(shot.data[i] - PAGE.r) >= 4 ||
      Math.abs(shot.data[i + 1] - PAGE.g) >= 4 ||
      Math.abs(shot.data[i + 2] - PAGE.b) >= 4
    )
      lit++;
  test.info().annotations.push({
    type: "glow",
    description: `${((100 * lit) / (shot.width * shot.height)).toFixed(1)}% of the viewport lit`,
  });
  expect(lit / (shot.width * shot.height)).toBeGreaterThanOrEqual(0.1);

  // With the glow hidden as well, nothing but the page color is left.
  await nothingVisible(page);
  const bare = await pixels(page, page.context());
  let off = 0;
  for (let i = 0; i < bare.data.length; i += 4)
    if (
      bare.data[i] !== PAGE.r ||
      bare.data[i + 1] !== PAGE.g ||
      bare.data[i + 2] !== PAGE.b
    )
      off++;
  expect(off).toBe(0);
});

test("at rest on a phone the glow stays under the bound", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showShared(page, P0, true);
  await settled(page);
  const state = await expectPlainBlending(page);
  expect(state.layers.map((layer) => layer.colors)).toEqual([expected(P0)]);
  await onlyAtmosphere(page);
  expect(await brightest(page)).toBeLessThanOrEqual(CEILING);
});

test("a shared link gets a glow from its colors", async ({ page }) => {
  await showShared(page, P2, true);
  await expect(layers(page)).toHaveCount(1);
  expect((await glow(page)).layers[0].colors).toBe(expected(P2));
  // Three colors still make three blobs; none is brighter than the cap.
  expect(expected(P2).split(",")).toEqual(
    ["#808080", "#ff8000", "#0080ff"].map((hex) =>
      rgbToHex(atmosphereColor(hexToRgb(hex))),
    ),
  );
});

test("frozen mid-crossfade, the two layers share the glow's opacity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await holdFades(page);
  await showShared(page, P0, true);
  await settled(page);
  await showShared(page, P1);
  await expect(layers(page)).toHaveCount(2);
  await fadeTo(page, 300);
  const state = await expectPlainBlending(page);
  expect(state.layers.map((layer) => layer.colors)).toEqual([
    expected(P0),
    expected(P1),
  ]);
  // Halfway through an ease-in-out fade, each holds half.
  for (const layer of state.layers)
    expect(layer.opacity).toBeCloseTo(ATMOSPHERE_OPACITY / 2, 3);
  const ids = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.id.startsWith("atmosphere-"))
      .map((a) => `${a.id} ${a.effect!.getTiming().duration}`),
  );
  expect(ids).toEqual(["atmosphere-fade 600", "atmosphere-fade 600"]);
  await onlyAtmosphere(page);
  expect(await brightest(page)).toBeLessThanOrEqual(CEILING);

  await finishFades(page);
  await expect(layers(page)).toHaveCount(1);
  expect((await glow(page)).layers[0]).toMatchObject({
    colors: expected(P1),
    opacity: ATMOSPHERE_OPACITY,
  });
});

test("three palettes within 300 ms make one more fade, to the latest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mostLayers = await watchLayers(page);
  await holdFades(page);
  await showShared(page, P0, true);
  await settled(page);

  await showShared(page, P1);
  await expect(layers(page)).toHaveCount(2);
  await fadeTo(page, 100);
  await expectPlainBlending(page);
  await showShared(page, P2);
  await fadeTo(page, 200);
  await expectPlainBlending(page);
  await showShared(page, P3);
  await fadeTo(page, 300);
  // The running fade is untouched: still P0 to P1.
  const midway = await expectPlainBlending(page);
  expect(midway.layers.map((layer) => layer.colors)).toEqual([
    expected(P0),
    expected(P1),
  ]);

  // It finishes, then a single fade runs to the latest palette, skipping P2.
  await finishFades(page);
  await expect
    .poll(async () => (await glow(page)).layers.map((layer) => layer.colors))
    .toEqual([expected(P1), expected(P3)]);
  await fadeTo(page, 300);
  await expectPlainBlending(page);
  const style = await onlyAtmosphere(page);
  expect(await brightest(page)).toBeLessThanOrEqual(CEILING);
  await style.evaluate((el) => el.remove());

  await finishFades(page);
  await expect(layers(page)).toHaveCount(1);
  expect((await glow(page)).layers[0]).toMatchObject({
    colors: expected(P3),
    opacity: ATMOSPHERE_OPACITY,
  });
  expect(await mostLayers()).toBe(2);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id.startsWith("atmosphere-"))
          .length,
    ),
  ).toBe(0);
});

test("a fade left to run finishes on its own", async ({ page }) => {
  await showShared(page, P0, true);
  await settled(page);
  await showShared(page, P1);
  await expect(layers(page)).toHaveCount(1, { timeout: 3000 });
  expect((await glow(page)).layers[0]).toMatchObject({
    colors: expected(P1),
    opacity: ATMOSPHERE_OPACITY,
  });
});

test("with reduced motion each palette swaps the single layer at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mostLayers = await watchLayers(page);
  await showShared(page, P0, true);
  for (const palette of [P1, P2, P3]) {
    await showShared(page, palette);
    await expect(layers(page)).toHaveCount(1);
    expect((await glow(page)).layers[0]).toMatchObject({
      colors: expected(palette),
      opacity: ATMOSPHERE_OPACITY,
    });
  }
  expect(await mostLayers()).toBe(1);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id.startsWith("atmosphere-"))
          .length,
    ),
  ).toBe(0);
});
