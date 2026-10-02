import { test, expect } from "@playwright/test";
import { capability, pointsCanvas, host } from "./stage-checks";

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
