import { test, expect } from "@playwright/test";
import { capability, pointsCanvas, host } from "./stage-checks";
import { ready, stageDone } from "./helpers";

test("same-photo changes release the contexts they replace", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const contexts: WebGL2RenderingContext[] = [];
    (window as unknown as { __contexts: typeof contexts }).__contexts =
      contexts;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      const context = (getContext as (...a: unknown[]) => unknown).apply(
        this,
        args,
      );
      if (
        args[0] === "webgl2" &&
        context &&
        !contexts.includes(context as WebGL2RenderingContext)
      )
        contexts.push(context as WebGL2RenderingContext);
      return context;
    } as typeof getContext;
  });
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-mode", "webgl");
  await stageDone(page);
  for (const name of ["Perceptual", "RGB", "Perceptual", "RGB"]) {
    await page.getByRole("radio", { name, exact: true }).check();
    await ready(page);
    await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/);
  }
  const counts = await page.evaluate(() => {
    const contexts = (
      window as unknown as { __contexts: WebGL2RenderingContext[] }
    ).__contexts;
    return {
      created: contexts.length,
      live: contexts.filter((c) => !c.isContextLost()).length,
    };
  });
  expect(counts.created).toBeGreaterThanOrEqual(5);
  expect(counts.live).toBe(1);
});

test("context loss replaces WebGL with a fresh painted canvas", async ({
  page,
}) => {
  await capability(page, true);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-mode", "webgl");
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  await page.locator(".stage-points").evaluate((canvas: HTMLCanvasElement) => {
    canvas.dataset.oldCanvas = "true";
    const extension = canvas
      .getContext("webgl2")!
      .getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Context-loss extension missing");
    extension.loseContext();
  });
  await expect(host(page)).toHaveAttribute("data-stage-mode", "2d");
  await expect(page.locator("[data-old-canvas]")).toHaveCount(0);
  await expect(host(page)).toHaveAttribute("data-stage-phase", "done");
  expect((await pointsCanvas(page)).drawn).toBeGreaterThanOrEqual(500);
  expect(errors).toEqual([]);
});
