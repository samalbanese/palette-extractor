import { test, expect, type Page } from "@playwright/test";
import { stageDone } from "./helpers";
import { afterStageChange, CURRENT_POINTS, host } from "./stage-checks";

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
/** A slow software renderer can take far longer than the ease to draw. */
const SETTLE = { timeout: 5000 };

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
    // The sky fades to a ghost while Amber is in focus. WebGL draws several
    // times the 2D painter's points, so more faint ones stack there.
    await expect.poll(() => visible(page), SETTLE).toBeLessThan(calm * 0.25);
    // Off the swatches, the whole cloud comes back.
    await page.mouse.move(2, 2);
    await expect(host(page)).not.toHaveAttribute("data-stage-focus", /.*/);
    await expect.poll(() => visible(page), SETTLE).toBeGreaterThan(calm * 0.8);
  });

test("a swatch reached by keyboard lights up its colors too", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  await eased(page);
  const calm = await visible(page);
  await page.locator(".swatch").nth(1).locator(".swatch-select").focus();
  await expect(host(page)).toHaveAttribute("data-stage-focus", "1");
  await page.locator(".swatch").nth(2).locator(".swatch-select").focus();
  await expect(host(page)).toHaveAttribute("data-stage-focus", "2");
  await expect.poll(() => visible(page), SETTLE).toBeLessThan(calm * 0.25);
  // A pointer passing over the page does not take the keyboard's focus away.
  await page.mouse.move(2, 2);
  await page.mouse.move(40, 40);
  await eased(page);
  await expect(host(page)).toHaveAttribute("data-stage-focus", "2");
  // Read once, after the time a lost focus would take to fade back.
  expect(await visible(page)).toBeLessThan(calm * 0.25);
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
        // Small steps until the stage starts: its code loads in real time, and
        // racing the page clock ahead could pass the first-load deadline.
        const started = await host(page).getAttribute("data-stage-started-at");
        await page.clock.runFor(started ? 16 : 2);
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

test("a swatch still under the pointer stays lit after the stage restarts", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  await page.locator(".swatch").nth(2).hover();
  await expect(host(page)).toHaveAttribute("data-stage-focus", "2");
  // Switched without moving the pointer, so no new hover arrives.
  await afterStageChange(page, () =>
    page
      .getByRole("radio", { name: "Perceptual", exact: true })
      .evaluate((radio: HTMLInputElement) => radio.click()),
  );
  const under = await page.evaluate(
    () =>
      document.querySelector<HTMLElement>(".swatch:hover .swatch-color")
        ?.dataset.swatchIndex,
  );
  expect(under).toBeDefined();
  await expect(host(page)).toHaveAttribute("data-stage-focus", under!);
});

test("reduced motion turned on mid-fade lets the whole cloud come back", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  await page.mouse.move(2, 2);
  await eased(page);
  const calm = await visible(page);
  await page.locator(".swatch").nth(2).hover();
  await eased(page);
  await page.mouse.move(2, 2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => visible(page), SETTLE).toBeGreaterThan(calm * 0.8);
});

test("with reduced motion, moving straight to another swatch redraws at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await stageDone(page);
  await page.mouse.move(2, 2);
  await eased(page);
  const calm = await visible(page);
  await page.locator(".swatch").nth(2).hover();
  await expect.poll(() => visible(page), SETTLE).toBeLessThan(calm * 0.25);
  // Blue Gray, the sky: from one lit swatch to another, no calm between.
  await page.locator(".swatch").nth(0).hover();
  await expect(host(page)).toHaveAttribute("data-stage-focus", "0");
  await expect.poll(() => visible(page), SETTLE).toBeGreaterThan(calm * 0.6);
});

test("a resize partway through a swatch's fade lets it keep easing", async ({
  page,
}) => {
  await page.clock.install({ time: 0 });
  await page.goto("/");
  await stageDone(page);
  // From here the clock moves only when stepped, however slow the machine.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
  await page.mouse.move(2, 2);
  await page.clock.runFor(400);
  const calm = await visible(page);
  await page.locator(".swatch").nth(2).hover();
  await page.clock.runFor(48);
  // Wide enough to change the frame, too little to change the layout.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width - 8, height: size.height });
  await page.clock.runFor(16);
  const partway = await visible(page);
  await page.clock.runFor(400);
  const dimmed = await visible(page);
  // A third of the way through, far more of the sky shows than at the end.
  expect(dimmed).toBeLessThan(calm * 0.25);
  expect(partway).toBeGreaterThan(dimmed + (calm - dimmed) * 0.25);
});

test("a key pressed after clicking a swatch lights it as keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  await page.locator(".swatch").nth(2).locator(".swatch-select").click();
  // Clicked, not keyed: moving off the swatches clears it.
  await page.mouse.move(2, 2);
  await expect(host(page)).not.toHaveAttribute("data-stage-focus", /.*/);
  await page.keyboard.press("Shift");
  await expect(host(page)).toHaveAttribute("data-stage-focus", "2");
});
