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
  // A stalled runner can pause between the last move and the release, which
  // reads as a hand that stopped before letting go, so the throw is retried.
  await expect(async () => {
    await page.mouse.move(x - box.width / 4, y);
    await page.mouse.down();
    await page.mouse.move(x + box.width / 4, y, { steps: 4 });
    await page.mouse.up();
    const start = Date.now();
    const released = await degrees(page);
    await page.waitForTimeout(300);
    const glide = moved(released, await degrees(page));
    // Read late, the slow turn alone could cover the distance; such an
    // attempt says nothing about the throw and is retried.
    expect(Date.now() - start).toBeLessThan(450);
    // The slow turn alone covers under 5 degrees in 300 ms.
    expect(glide).toBeGreaterThan(8);
  }).toPass({ timeout: 15000 });
  // Long after, it is back to the slow turn: about 15 degrees a second.
  await page.waitForTimeout(3000);
  const later = await degrees(page);
  await page.waitForTimeout(1000);
  const rate = moved(later, await degrees(page));
  expect(rate).toBeGreaterThan(8);
  expect(rate).toBeLessThan(25);
});

test("a hand holding the cloud keeps it when the palette changes", async ({
  page,
}) => {
  const { x, y, box } = await center(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width / 4, y, { steps: 8 });
  const held = await degrees(page);
  const swatches = await page.locator(".swatch").count();
  // The button is clicked from script so the mouse stays down on the cloud.
  await page
    .getByRole("button", { name: "Fewer colors", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator(".swatch")).toHaveCount(swatches - 1);
  await page.waitForTimeout(500);
  // Neither snapped back nor turning by itself while still held.
  expect(await degrees(page)).toBe(held);
  await page.mouse.move(x + box.width / 2, y, { steps: 8 });
  const turned = moved(held, await degrees(page));
  expect(turned).toBeGreaterThan(40);
  expect(turned).toBeLessThan(50);
  await page.mouse.up();
});

test("a drag that carries on while the stage restarts keeps its scale", async ({
  page,
}) => {
  // Holds the restarted stage before it has measured its frame or decoded
  // its photo. Normally that gap lasts a frame; held, the hand can move
  // inside it.
  await page.addInitScript(() => {
    const win = window as unknown as { __holdDecode?: boolean };
    const observe = ResizeObserver.prototype.observe;
    ResizeObserver.prototype.observe = function (
      this: ResizeObserver,
      ...args: Parameters<ResizeObserver["observe"]>
    ) {
      if (!win.__holdDecode) observe.apply(this, args);
    };
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
      if (!win.__holdDecode || !this.matches(".source-frame > img"))
        return original.call(this);
      document.body.dataset.decodeHeld = "";
      return new Promise<void>(() => {});
    };
  });
  await page.reload();
  await stageDone(page);
  const { x, y } = await center(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 4 });
  await page.evaluate(() => {
    (window as unknown as { __holdDecode?: boolean }).__holdDecode = true;
  });
  await page
    .getByRole("button", { name: "Fewer colors", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("body")).toHaveAttribute("data-decode-held", "");
  const before = await degrees(page);
  // Three pixels is a fraction of a degree across the frame.
  await page.mouse.move(x + 43, y);
  await page.waitForTimeout(50);
  expect(Math.abs(moved(before, await degrees(page)))).toBeLessThan(3);
  await page.mouse.up();
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  async function touch(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: string, x?: number, y?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: y!, id: 1 }],
      });
    return send;
  }

  test("a swipe that is mostly up and down leaves the cloud where it is", async ({
    page,
  }) => {
    const { x, y } = await center(page);
    const send = await touch(page);
    await send("touchStart", x, y);
    const start = await degrees(page);
    // Drifting 30 px sideways while moving 84 px down is still a scroll.
    // Turned by that drift, the cloud would move about 8 degrees; if the
    // browser scrolls instead, the slow turn picks up again from rest.
    for (let k = 1; k <= 6; k++) await send("touchMove", x + k * 5, y + k * 14);
    await page.waitForTimeout(50);
    expect(Math.abs(moved(start, await degrees(page)))).toBeLessThan(3);
    await send("touchEnd");
  });

  test("a gesture the browser takes over leaves no fling", async ({ page }) => {
    const { x, y, box } = await center(page);
    const send = await touch(page);
    await send("touchStart", x - box.width / 4, y);
    for (let k = 1; k <= 4; k++)
      await send("touchMove", x - box.width / 4 + (k * box.width) / 8, y);
    await send("touchCancel");
    // Touch moves reach the page on its next frame, so the reading waits a
    // moment for the last one.
    await page.waitForTimeout(50);
    const cancelled = await degrees(page);
    await page.waitForTimeout(300);
    // A fling would cover well over 8 degrees here; the slow turn under 5.
    expect(moved(cancelled, await degrees(page))).toBeLessThan(5);
  });
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
  await page.keyboard.press("End");
  expect(await degrees(page)).toBe(359);
  await page.keyboard.press("Home");
  expect(await degrees(page)).toBe(0);
  // Browser shortcuts such as Alt+Left are left to the browser.
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Control+ArrowRight");
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

test("the photo credit over the cloud stays a full-size target", async ({
  page,
}) => {
  const link = page.locator(".image-caption a");
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(24);
  // Its click goes to the link, not to the cloud behind it.
  const onLink = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest(".image-caption a"),
    [box.x + box.width / 2, box.y + 2],
  );
  expect(onLink).toBe(true);
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

test("a quiet hint says the cloud turns, until it is first turned", async ({
  page,
}) => {
  const hint = page.locator(".stage-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText("Drag to turn");
  // Not read out: the slider already says what it does.
  await expect(hint).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await expect(hint).toBeHidden();
  await page.getByRole("button", { name: "Color space", exact: true }).click();
  await expect(hint).toBeVisible();
  const { x, y, box } = await center(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width / 8, y, { steps: 4 });
  await page.mouse.up();
  await expect(hint).toBeHidden();
  // A new photo does not bring it back.
  await page.locator(".sample-row button").nth(1).click();
  await stageDone(page);
  await expect(hint).toBeHidden();
});

test("turning by keyboard also retires the hint", async ({ page }) => {
  await turn(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".stage-hint")).toBeHidden();
});

test("a hand moving only up and down leaves the hint in place", async ({
  page,
}) => {
  const { x, y, box } = await center(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + box.height / 4, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".stage-hint")).toBeVisible();
});
