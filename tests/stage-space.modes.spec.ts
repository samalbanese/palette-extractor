import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { ready, stageDone } from "./helpers";
import { afterStageChange, CURRENT_POINTS, host } from "./stage-checks";

// Runs once with WebGL and once with the 2D painter. Reduced motion holds the
// cloud at its fixed resting angle, so every pixel is reproducible. A dense
// screen gives the compact Perceptual cloud enough pixels to measure.
test.use({ deviceScaleFactor: 2 });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const mode = (testInfo: TestInfo) =>
  testInfo.project.name === "modes-webgl" ? "webgl" : "2d";

const space = (page: Page, name: "RGB" | "Perceptual") =>
  page.getByRole("radio", { name, exact: true });

/** Keeps a copy of the points canvas on show under `key`. */
function keep(page: Page, key: string) {
  return page
    .locator(CURRENT_POINTS)
    .evaluate((canvas: HTMLCanvasElement, key) => {
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(canvas, 0, 0);
      const store = window as unknown as Record<string, unknown>;
      store[key] = {
        image: ctx.getImageData(0, 0, copy.width, copy.height),
        scale: canvas.width / canvas.getBoundingClientRect().width,
      };
    }, key);
}

/** Painted pixels of `after`, and how many of them `before` did not show. */
function compare(page: Page, before: string, after: string) {
  return page.evaluate(
    ([before, after]) => {
      const store = window as unknown as Record<string, { image: ImageData }>;
      const a = store[before].image,
        b = store[after].image;
      if (a.width !== b.width || a.height !== b.height) return null;
      let painted = 0,
        differ = 0;
      for (let i = 0; i < b.data.length; i += 4) {
        if (b.data[i + 3] === 0) continue;
        painted++;
        if (
          a.data[i + 3] === 0 ||
          [0, 1, 2].some((k) => Math.abs(a.data[i + k] - b.data[i + k]) > 8)
        )
          differ++;
      }
      return { painted, differ };
    },
    [before, after],
  );
}

test("switching color space redraws the cloud in the new space", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await ready(page);
  await stageDone(page);
  await expect(host(page)).toHaveAttribute("data-stage-mode", mode(testInfo));
  await expect(host(page)).toHaveAttribute("data-stage-space", "rgb");
  await keep(page, "rgb");

  await afterStageChange(page, () => space(page, "Perceptual").check());
  await expect(host(page)).toHaveAttribute("data-stage-space", "oklab");
  await keep(page, "oklab");
  await afterStageChange(page, () => space(page, "RGB").check());
  await expect(host(page)).toHaveAttribute("data-stage-space", "rgb");
  await keep(page, "back");

  for (const [before, after] of [
    ["rgb", "oklab"],
    ["oklab", "back"],
  ]) {
    const result = await compare(page, before, after);
    console.log(
      `STAGE_SPACE_REDRAW mode=${mode(testInfo)} ${before}->${after} ${JSON.stringify(result)}`,
    );
    expect(result).not.toBeNull();
    expect(result!.painted, `${before} to ${after}`).toBeGreaterThanOrEqual(
      1000,
    );
    expect(
      result!.differ / result!.painted,
      `${before} to ${after}`,
    ).toBeGreaterThanOrEqual(0.05);
  }
});

// Two flat colors, each landing on one spot of the cloud. The positions were
// recorded once from the projection in src/stage/math.ts (resting angle
// -π/4) for a 597.984375 × 325 stage, the size it has at 1440 × 900.
const FIXTURE = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" shape-rendering="crispEdges"><rect width="50" height="100" fill="#c83c3c"/><rect x="50" width="50" height="100" fill="#3cb4c8"/></svg>`,
);
const STAGE = { width: 597.984375, height: 325 };
const RECORDED = [
  {
    rgb: [200, 60, 60],
    at: { rgb: [376.26, 212.95], oklab: [297.34, 139.21] },
  },
  {
    rgb: [60, 180, 200],
    at: { rgb: [221.72, 124.94], oklab: [337.08, 187.29] },
  },
];

/** Whether the kept canvas has a painted pixel of `rgb` (or any painted
    pixel, when `rgb` is null) within 3 CSS pixels of the point. */
function paintedNear(
  page: Page,
  key: string,
  at: number[],
  rgb: number[] | null,
) {
  return page.evaluate(
    ({ key, at, rgb }) => {
      const { image, scale } = (
        window as unknown as Record<string, { image: ImageData; scale: number }>
      )[key];
      const reach = Math.ceil(3 * scale),
        cx = Math.round(at[0] * scale),
        cy = Math.round(at[1] * scale);
      for (let y = cy - reach; y <= cy + reach; y++)
        for (let x = cx - reach; x <= cx + reach; x++) {
          if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
          const i = (y * image.width + x) * 4;
          if (image.data[i + 3] === 0) continue;
          if (
            !rgb ||
            rgb.every((v, k) => Math.abs(image.data[i + k] - v) <= 30)
          )
            return true;
        }
      return false;
    },
    { key, at, rgb },
  );
}

test("points sit at the recorded positions for each space", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await ready(page);
  await stageDone(page);
  await afterStageChange(page, () =>
    page.locator("input[type=file]").setInputFiles({
      name: "two-colors.svg",
      mimeType: "image/svg+xml",
      buffer: FIXTURE,
    }),
  );
  await expect(page.locator(".swatch")).toHaveCount(2);
  await expect(host(page)).toHaveAttribute("data-stage-mode", mode(testInfo));
  const size = await host(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  expect(size.width).toBeCloseTo(STAGE.width, 0);
  expect(size.height).toBeCloseTo(STAGE.height, 0);

  await expect(host(page)).toHaveAttribute("data-stage-space", "rgb");
  await keep(page, "rgb");
  await afterStageChange(page, () => space(page, "Perceptual").check());
  await expect(host(page)).toHaveAttribute("data-stage-space", "oklab");
  await keep(page, "oklab");

  for (const { rgb, at } of RECORDED) {
    expect(await paintedNear(page, "rgb", at.rgb, rgb), `${rgb} in RGB`).toBe(
      true,
    );
    expect(
      await paintedNear(page, "rgb", at.oklab, null),
      `${rgb} before Perceptual`,
    ).toBe(false);
    expect(
      await paintedNear(page, "oklab", at.oklab, rgb),
      `${rgb} in Perceptual`,
    ).toBe(true);
    expect(
      await paintedNear(page, "oklab", at.rgb, null),
      `${rgb} left in RGB`,
    ).toBe(false);
  }
});
