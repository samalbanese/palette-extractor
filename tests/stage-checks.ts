import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const host = (page: Page) => page.locator(".stage-host");

/** Makes a change, then waits for the stage it starts: the old canvas gone,
    a new one in its place and that stage finished. The host keeps the last
    finish time until the new stage starts, so waiting on it alone can pass
    on the previous one. */
export async function afterStageChange(
  page: Page,
  change: () => Promise<void>,
) {
  await page
    .locator(".stage-points")
    .evaluate((canvas) => canvas.setAttribute("data-replaced", ""));
  await change();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvases = [...document.querySelectorAll(".stage-points")];
          const stage = document.querySelector<HTMLElement>(".stage-host")!;
          // Reported whole, so a timeout shows which part never arrived.
          return {
            canvases: canvases.map((c) =>
              c.hasAttribute("data-replaced") ? "old" : "new",
            ),
            done: /\d/.test(stage.dataset.stageDoneAt ?? ""),
            phase: stage.dataset.stagePhase,
          };
        }),
      { timeout: 15000 },
    )
    .toEqual({ canvases: ["new"], done: true, phase: "done" });
}
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
