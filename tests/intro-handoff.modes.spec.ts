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
    let visible = 0,
      left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (let i = 3; i < data.length; i += 4)
      if (data[i] > 38) {
        visible++;
        const x = ((i - 3) / 4) % copy.width,
          y = Math.floor((i - 3) / 4 / copy.width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    return {
      step: document.querySelector<HTMLElement>(".stage-host")!.dataset
        .stageStep,
      visible,
      // The drawn cloud's larger side, in canvas pixels.
      size: visible ? Math.max(right - left, bottom - top) : 0,
      chips: document.querySelectorAll(".stage-flyer").length,
    };
  }, CURRENT_POINTS);

for (const width of [1440, 390])
  test(`the cloud keeps its size and chips leave from its groups with no blank frame at ${width}`, async ({
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
          // Small steps until the stage starts: its code loads in real time, and
          // racing the page clock ahead could pass the first-load deadline.
          const started = await host(page).getAttribute(
            "data-stage-started-at",
          );
          await page.clock.runFor(started ? 16 : 2);
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
    for (let i = 0; i < 260; i++) {
      const frame = await shown(page);
      frames.push(frame);
      if (frame.step === "done") break;
      await page.clock.runFor(16);
    }
    const handoff = frames.slice(1).filter((f) => f.step !== "release");
    expect(handoff.length).toBeGreaterThan(5);
    const report = frames.map(
      (f) => `${f.step}:${f.visible}/${f.size}/${f.chips}`,
    );
    // The cloud the photo became stays the cloud: it never thins out or
    // shrinks toward its group centers while the chips leave, and never has
    // to grow back afterwards. Turning alone changes its outline by far less
    // than these margins.
    let largest = frames[0].size;
    for (const frame of frames.slice(1)) {
      expect(frame.visible, report.join(" ")).toBeGreaterThanOrEqual(
        split * 0.5,
      );
      expect(frame.size, report.join(" ")).toBeGreaterThanOrEqual(
        largest * 0.8,
      );
      largest = Math.max(largest, frame.size);
    }
    // Chips leave while the groups they come from are still showing.
    const launch = handoff.findIndex((f) => f.chips > 0);
    expect(launch, report.join(" ")).toBeGreaterThanOrEqual(0);
  });
