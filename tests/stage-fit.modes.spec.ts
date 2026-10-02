import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { ready, stageDone } from "./helpers";
import { afterStageChange, CURRENT_POINTS, host } from "./stage-checks";

// Runs once with WebGL and once with the 2D painter. Reduced motion holds the
// cloud at its resting angle, so the measurement is the cloud at rest.
test.use({ deviceScaleFactor: 2 });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const mode = (testInfo: TestInfo) =>
  testInfo.project.name === "modes-webgl" ? "webgl" : "2d";

/** The painted area of the points canvas, in CSS pixels of the stage. */
function paintedBounds(page: Page) {
  return page.locator(CURRENT_POINTS).evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (let y = 0; y < copy.height; y++)
      for (let x = 0; x < copy.width; x++)
        if (data[(y * copy.width + x) * 4 + 3] > 0) {
          left = Math.min(left, x);
          right = Math.max(right, x + 1);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y + 1);
        }
    const frame = canvas.getBoundingClientRect();
    const scale = canvas.width / frame.width;
    return {
      width: frame.width,
      height: frame.height,
      left: left / scale,
      right: right / scale,
      top: top / scale,
      bottom: bottom / scale,
    };
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`the built-in photos' clouds fill the stage at ${viewport.width} x ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await ready(page);
    await stageDone(page);
    await expect(host(page)).toHaveAttribute("data-stage-mode", mode(testInfo));

    // Golden dunes in RGB, then Perceptual; Forest floor in Perceptual, then
    // RGB. Each change replaces the stage.
    const views = [
      { photo: "Golden dunes", space: "RGB" },
      { photo: "Golden dunes", space: "Perceptual" },
      { photo: "Forest floor", space: "Perceptual" },
      { photo: "Forest floor", space: "RGB" },
    ] as const;
    let previous: (typeof views)[number] | undefined;
    for (const view of views) {
      if (previous && previous.photo !== view.photo)
        await afterStageChange(page, () =>
          page.getByRole("button", { name: `Try ${view.photo}` }).click(),
        );
      else if (previous && previous.space !== view.space)
        await afterStageChange(page, () =>
          page.getByRole("radio", { name: view.space, exact: true }).check(),
        );
      previous = view;
      await expect(page.locator(".image-caption")).toContainText(view.photo);
      await expect(host(page)).toHaveAttribute(
        "data-stage-space",
        view.space === "RGB" ? "rgb" : "oklab",
      );
      const label = `${view.photo} ${view.space}`;
      const box = await paintedBounds(page);
      const spanX = box.right - box.left,
        spanY = box.bottom - box.top;
      // Coverage on the frame's own axes, inside the margin: the fit fills
      // one of them to the margin at some yaw, so at rest the larger share
      // is the one to watch.
      const cover = Math.max(
        spanX / (box.width - 44),
        spanY / (box.height - 44),
      );
      const side = Math.max(spanX, spanY) / Math.min(box.width, box.height);
      console.log(
        `STAGE_FIT mode=${mode(testInfo)} ${viewport.width}x${viewport.height} ${label} ${JSON.stringify(box)} cover=${cover.toFixed(3)} side=${side.toFixed(3)}`,
      );
      if (view.photo === "Golden dunes") {
        expect(cover, `${label} coverage`).toBeGreaterThanOrEqual(0.45);
        expect(
          side,
          `${label} share of the shorter side`,
        ).toBeGreaterThanOrEqual(0.45);
      }
      // Points keep the 22 px margin, less their own radius.
      const margin = Math.min(
        box.left,
        box.top,
        box.width - box.right,
        box.height - box.bottom,
      );
      expect(margin, `${label} margin`).toBeGreaterThanOrEqual(18);
    }
  });
