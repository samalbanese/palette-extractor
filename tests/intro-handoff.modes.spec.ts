import { test, expect, type Page } from "@playwright/test";
import { CURRENT_POINTS, host } from "./stage-checks";

// Runs once with WebGL and once with the 2D painter. The page clock steps the
// intro one frame at a time from the last split to the release.

/** Points canvas pixels a viewer can see (alpha above 15%), and the chips. */
const shown = (page: Page) =>
  page.evaluate((selector) => {
    const canvas = document.querySelector<HTMLCanvasElement>(selector)!;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let visible = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 38) visible++;
    return {
      step: document.querySelector<HTMLElement>(".stage-host")!.dataset
        .stageStep,
      visible,
      chips: document.querySelectorAll(".stage-flyer").length,
    };
  }, CURRENT_POINTS);

for (const width of [1440, 390])
  test(`the cloud condenses into its groups and chips leave from them with no blank frame at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    await page.goto("/");
    const frames: Awaited<ReturnType<typeof shown>>[] = [];
    await expect
      .poll(
        async () => {
          await page.clock.runFor(16);
          const step = await host(page).getAttribute("data-stage-step");
          if (step === "split")
            frames.splice(0, frames.length, await shown(page));
          return step;
        },
        { timeout: 20000, intervals: [0] },
      )
      .toMatch(/converge|flight/);
    const split = frames[0].visible;
    expect(split).toBeGreaterThan(500);
    for (let i = 0; i < 200; i++) {
      const frame = await shown(page);
      frames.push(frame);
      if (frame.step === "release" || frame.step === "done") break;
      await page.clock.runFor(16);
    }
    const handoff = frames.slice(1).filter((f) => f.step !== "release");
    expect(handoff.length).toBeGreaterThan(5);
    const report = handoff.map((f) => `${f.step}:${f.visible}/${f.chips}`);
    // Every frame keeps the condensed groups plainly on screen. A cloud
    // pulled all the way into its centroids shows well under 5% of the
    // pixels it showed while splitting.
    for (const frame of handoff)
      expect(frame.visible, report.join(" ")).toBeGreaterThanOrEqual(
        split * 0.06,
      );
    // Chips leave while the groups they come from are still showing.
    const launch = handoff.findIndex((f) => f.chips > 0);
    expect(launch, report.join(" ")).toBeGreaterThanOrEqual(0);
    expect(handoff[launch].visible).toBeGreaterThanOrEqual(split * 0.06);
  });
