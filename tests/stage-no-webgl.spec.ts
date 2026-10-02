import { test, expect } from "@playwright/test";
import { accessible, capability, pointsCanvas, host } from "./stage-checks";

for (const width of [390, 768, 1440])
  test(`2D fallback draws and is accessible at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await capability(page, false);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/");
    await expect(host(page)).toHaveAttribute("data-stage-mode", "2d");
    await expect(host(page)).toHaveAttribute("data-stage-phase", "done");
    expect((await pointsCanvas(page)).drawn).toBeGreaterThanOrEqual(500);
    await accessible(page);
    expect(errors).toEqual([]);
  });
