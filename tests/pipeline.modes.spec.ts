import { test, expect, type Page } from "@playwright/test";
import { ready } from "./helpers";

// Recorded from the production build on 2026-10-02 before the extraction
// pipeline changed. Any drift here means the quantizer input changed.
const PALETTES = {
  "Golden dunes": {
    rgb: ["#5f92ad", "#352114", "#d27108", "#84afbd", "#975112", "#7a7769"],
    oklab: ["#6193ae", "#342014", "#d77105", "#8d6e55", "#82aebe", "#6f4222"],
  },
  "Forest floor": {
    rgb: ["#17251e", "#233531", "#29403a", "#30514a", "#337265", "#2c3731"],
    oklab: ["#16231c", "#212f2a", "#273833", "#0f1c13", "#304e47", "#366f63"],
  },
};

async function swatchHexes(page: Page): Promise<string[]> {
  return page
    .locator(".swatch-select")
    .evaluateAll((els) =>
      els.map(
        (el) => el.getAttribute("aria-label")!.match(/#[0-9a-f]{6}/i)![0],
      ),
    );
}

/**
 * A still picture of How it works: its points and box layers once the final
 * split step is drawn. With reduced motion that step is a single still
 * frame, so the picture identifies which image's pixels and boxes are on
 * screen.
 */
async function algorithmPicture(page: Page): Promise<string> {
  await page.getByRole("tab", { name: "How it works" }).click();
  const host = page.locator(".algorithm-renderer");
  const steps = page.locator(".cube-bottomline");
  await expect(steps).toContainText(/(\d+) \/ \1 steps/);
  const final =
    Number((await steps.textContent())!.match(/\/ (\d+) steps/)![1]) - 1;
  await expect(host).toHaveAttribute("data-step", String(final));
  await expect(host).toHaveAttribute("data-drawn-step", String(final));
  return host.evaluate((el) =>
    [".trace-points", ".trace-overlay"]
      .map((selector) =>
        el.querySelector<HTMLCanvasElement>(selector)!.toDataURL(),
      )
      .join(" "),
  );
}

for (const [name, expected] of Object.entries(PALETTES)) {
  test(`${name} extracts the same palette in both color spaces`, async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    if (name !== "Golden dunes") {
      await page.getByRole("button", { name: `Try ${name}` }).click();
      await expect(page.locator(".image-caption")).toContainText(name);
      await ready(page);
    }
    expect(await swatchHexes(page)).toEqual(expected.rgb);
    await page.getByRole("radio", { name: "Perceptual", exact: true }).check();
    await ready(page);
    await expect.poll(() => swatchHexes(page)).toEqual(expected.oklab);
  });
}

test("a slow earlier image never replaces the image chosen after it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Reference: a clean load of the second image.
  await page.goto("/");
  await ready(page);
  const firstImagePicture = await algorithmPicture(page);
  await page.getByRole("button", { name: "Try Coastal color" }).click();
  await expect(page.locator(".image-caption")).toContainText("Coastal color");
  await ready(page);
  const reference = await swatchHexes(page);
  const referencePicture = await algorithmPicture(page);
  // The picture must tell the two images apart, or comparing it proves nothing.
  expect(referencePicture).not.toEqual(firstImagePicture);

  // Race: every request for the first image is held back from page load on.
  // The sample button shows the same file as a thumbnail, so delaying only
  // later requests would be served from memory cache and never bite.
  const HOLD = 4000;
  let held = 0;
  await page.route("**/samples/fern.webp", async (route) => {
    held++;
    await new Promise((resolve) => setTimeout(resolve, HOLD));
    await route.continue();
  });
  const start = Date.now();
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await page.getByRole("button", { name: "Try Coastal color" }).click();
  // Both choices must land while the first image is still held back.
  expect(Date.now() - start).toBeLessThan(HOLD);
  await expect(page.locator(".image-caption")).toContainText("Coastal color");
  await ready(page);
  await page.waitForTimeout(HOLD + 1000); // let the held-back image arrive
  expect(held).toBeGreaterThan(0);
  await expect(page.locator(".image-caption")).toContainText("Coastal color");
  expect(await swatchHexes(page)).toEqual(reference);
  expect(await algorithmPicture(page)).toEqual(referencePicture);
});
