import { test, expect, type Page } from "@playwright/test";
import { stageDone } from "./helpers";
import { CURRENT_POINTS, host } from "./stage-checks";

// Runs once with WebGL and once with the 2D painter.

/**
 * Points canvas pixels a viewer can plainly see (alpha above 15%) that are
 * clearly blue: the sky of the Golden dunes, none of it amber.
 */
const visible = (page: Page) =>
  page.evaluate((selector) => {
    const canvas = document.querySelector<HTMLCanvasElement>(selector)!;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3] > 38 && data[i + 2] > data[i] + 30) count++;
    return count;
  }, CURRENT_POINTS);

/** Lets a change in focus ease in (160 ms) and draw. */
const eased = (page: Page) => page.waitForTimeout(450);

for (const reduced of [false, true])
  test(`a swatch under the pointer lights up its colors in the cloud${reduced ? " with reduced motion" : ""}`, async ({
    page,
  }) => {
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await stageDone(page);
    await page.mouse.move(2, 2);
    await eased(page);
    const calm = await visible(page);
    // Amber, about a quarter of the Golden dunes photo.
    await page.locator(".swatch").nth(2).hover();
    await expect(host(page)).toHaveAttribute("data-stage-focus", "2");
    await eased(page);
    expect(calm).toBeGreaterThan(500);
    // The sky all but disappears while Amber is in focus.
    expect(await visible(page)).toBeLessThan(calm * 0.15);
    // Off the swatches, the whole cloud comes back.
    await page.mouse.move(2, 2);
    await expect(host(page)).not.toHaveAttribute("data-stage-focus", /.*/);
    await eased(page);
    expect(await visible(page)).toBeGreaterThan(calm * 0.8);
  });

test("a swatch reached by keyboard lights up its colors too", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  await page.locator(".swatch").nth(1).locator(".swatch-select").focus();
  await expect(host(page)).toHaveAttribute("data-stage-focus", "1");
  await page.locator(".swatch").nth(3).locator(".swatch-select").focus();
  await expect(host(page)).toHaveAttribute("data-stage-focus", "3");
  // Focus leaving the page clears it.
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await expect(host(page)).not.toHaveAttribute("data-stage-focus", /.*/);
});

test("hovering a swatch during the intro leaves the intro alone", async ({
  page,
}) => {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto("/");
  await expect
    .poll(
      async () => {
        await page.clock.runFor(16);
        return host(page).getAttribute("data-stage-step");
      },
      { timeout: 20000, intervals: [0] },
    )
    .toBe("split");
  await page.locator(".swatch").nth(2).hover();
  await page.clock.runFor(48);
  // Hovering is not input that skips the intro.
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
});
