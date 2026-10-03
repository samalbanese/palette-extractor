import { test, expect, type Page } from "@playwright/test";
import { stageDone } from "./helpers";
import { accessible } from "./stage-checks";

const turn = (page: Page) =>
  page.getByRole("slider", { name: "Turn the color cloud" });

/** How far the cloud has been turned from where it rests, in degrees. */
const degrees = async (page: Page) =>
  Number(await turn(page).getAttribute("aria-valuenow"));

/** Degrees moved from `from` to `to` the short way round, signed. */
const moved = (from: number, to: number) => ((to - from + 540) % 360) - 180;

async function center(page: Page) {
  const box = (await turn(page).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await stageDone(page);
});

test("dragging across the cloud turns it, and it holds still while held", async ({
  page,
}) => {
  const { x, y, box } = await center(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const start = await degrees(page);
  await page.mouse.move(x + box.width / 4, y, { steps: 8 });
  // A quarter of the width is an eighth of a turn.
  const turned = moved(start, await degrees(page));
  expect(turned).toBeGreaterThan(40);
  expect(turned).toBeLessThan(50);
  const held = await degrees(page);
  await page.waitForTimeout(800);
  expect(await degrees(page)).toBe(held);
  await page.mouse.up();
  // Let go, the turning carries on by itself.
  await expect.poll(() => degrees(page), { timeout: 4000 }).not.toBe(held);
});

test("dragging left turns it the other way", async ({ page }) => {
  const { x, y, box } = await center(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const start = await degrees(page);
  await page.mouse.move(x - box.width / 4, y, { steps: 8 });
  expect(moved(start, await degrees(page))).toBeLessThan(-40);
  await page.mouse.up();
});

test("a fling glides on, then settles back into the slow turn", async ({
  page,
}) => {
  const { x, y, box } = await center(page);
  await page.mouse.move(x - box.width / 4, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width / 4, y, { steps: 4 });
  await page.mouse.up();
  const released = await degrees(page);
  await page.waitForTimeout(300);
  // The slow turn alone covers under 5 degrees in 300 ms.
  const glide = moved(released, await degrees(page));
  expect(glide).toBeGreaterThan(8);
  // Long after, it is back to the slow turn: about 15 degrees a second.
  await page.waitForTimeout(3000);
  const later = await degrees(page);
  await page.waitForTimeout(1000);
  const rate = moved(later, await degrees(page));
  expect(rate).toBeGreaterThan(8);
  expect(rate).toBeLessThan(25);
});

test("arrow keys turn it, and it waits while focused from the keyboard", async ({
  page,
}) => {
  await turn(page).focus();
  await page.keyboard.press("ArrowRight");
  const after = await degrees(page);
  await page.waitForTimeout(800);
  expect(await degrees(page)).toBe(after);
  await page.keyboard.press("ArrowRight");
  expect(moved(after, await degrees(page))).toBe(10);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect(await degrees(page)).toBe((after + 350) % 360);
  await page.keyboard.press("Home");
  expect(await degrees(page)).toBe(0);
  // Arrow keys turn the cloud instead of scrolling the page.
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.keyboard.press("Tab");
  await expect.poll(() => degrees(page), { timeout: 4000 }).not.toBe(0);
});

test("the slider is accessible and shows where focus is", async ({ page }) => {
  await turn(page).focus();
  await expect(turn(page)).toHaveAttribute("aria-valuetext", /\d+ degrees/);
  const outline = await turn(page).evaluate(
    (el) => getComputedStyle(el).outlineStyle,
  );
  expect(outline).not.toBe("none");
  await accessible(page);
});

test("phones can still scroll the page past the cloud", async ({ page }) => {
  await expect(turn(page)).toHaveCSS("touch-action", "pan-y");
});

test("the Photo view has nothing to turn", async ({ page }) => {
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await expect(turn(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Color space" }).click();
  await expect(turn(page)).toHaveCount(1);
});

test("with reduced motion it turns only by hand, and stops where it is let go", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await stageDone(page);
  expect(await degrees(page)).toBe(0);
  await page.waitForTimeout(600);
  expect(await degrees(page)).toBe(0);
  const { x, y, box } = await center(page);
  await page.mouse.move(x - box.width / 4, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width / 4, y, { steps: 4 });
  await page.mouse.up();
  const released = await degrees(page);
  expect(released).toBeGreaterThan(80);
  await page.waitForTimeout(600);
  expect(await degrees(page)).toBe(released);
  // What is drawn follows the hand.
  await expect(page.locator(".stage-host")).toHaveAttribute(
    "data-stage-angle",
    String(released),
  );
});
