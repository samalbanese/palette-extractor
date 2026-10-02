import { expect, type Page } from "@playwright/test";

export async function ready(page: Page) {
  await expect(page.locator("#workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".swatch").first()).toBeVisible();
}

// Contrast is only meaningful once entrance animations finish; mid-fade
// swatches blend with the page and read darker than they render at rest.
export async function settled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" ||
          a.effect?.getTiming().iterations === Infinity,
      ),
  );
}

export const svg = (color: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/></svg>`,
  );
