import { test, expect } from "@playwright/test";
import { stageDone } from "./helpers";
import { CURRENT_POINTS, host } from "./stage-checks";

// Runs once with WebGL and once with the 2D painter.

test("a half-covered pixel of the cloud keeps its point's color", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await stageDone(page);
  await expect(host(page)).toHaveAttribute(
    "data-stage-mode",
    testInfo.project.name === "modes-webgl" ? "webgl" : "2d",
  );
  // The brightest channel of pixels the points half cover, and of pixels
  // they fully cover. Read back without premultiplying, a half-covered
  // pixel is about as light as its point; alpha applied twice darkens it.
  const { half, full } = await page.evaluate((selector) => {
    const canvas = document.querySelector<HTMLCanvasElement>(selector)!;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    const sums = { half: [0, 0], full: [0, 0] };
    for (let i = 0; i < data.length; i += 4) {
      const light = Math.max(data[i], data[i + 1], data[i + 2]);
      const bucket =
        data[i + 3] >= 64 && data[i + 3] <= 160
          ? sums.half
          : data[i + 3] >= 200
            ? sums.full
            : null;
      if (!bucket) continue;
      bucket[0] += light;
      bucket[1]++;
    }
    return {
      half: { mean: sums.half[0] / sums.half[1], count: sums.half[1] },
      full: { mean: sums.full[0] / sums.full[1], count: sums.full[1] },
    };
  }, CURRENT_POINTS);
  expect(half.count).toBeGreaterThan(200);
  expect(full.count).toBeGreaterThan(200);
  // About 0.75 on this photo, where the faint far points are also the
  // darker ones; alpha applied twice reads about 0.37.
  expect(half.mean, JSON.stringify({ half, full })).toBeGreaterThan(
    full.mean * 0.6,
  );
});
