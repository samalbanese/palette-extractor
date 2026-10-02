import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const host = (page: Page) => page.locator(".stage-host");
export async function capability(page: Page, expected: boolean) {
  expect(
    await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    ),
  ).toBe(expected);
}

/** Copies the points canvas and reports what it shows, across its whole area. */
export async function pointsCanvas(page: Page) {
  return page.locator(".stage-points").evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let drawn = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) drawn++;
    return { drawn, image: copy.toDataURL() };
  });
}

/** Counts every animation frame the page requests, from before it loads. */
export async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    (window as unknown as { __frames: number }).__frames = 0;
    window.requestAnimationFrame = (callback) => {
      (window as unknown as { __frames: number }).__frames++;
      return original(callback);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { __frames: number }).__frames);
}

export async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}
