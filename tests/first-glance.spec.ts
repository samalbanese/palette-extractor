import { test, expect } from "@playwright/test";
import { ready } from "./helpers";

test("the identity preview and the contrast tab show the same ratio for the same pair", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const note = await page.locator(".contrast-note").innerText();
  const preview = note.match(/(\d+\.\d{2})\s*:1/)?.[1];
  await page.getByRole("tab", { name: "Contrast check" }).click();
  // Pairs are sorted strongest first, and the preview uses the strongest pair.
  const sample = await page
    .locator(".contrast-sample > span:last-child")
    .first()
    .innerText();
  const panel = sample.match(/(\d+\.\d{2}):1/)?.[1];
  expect(preview).toBeTruthy();
  expect(panel).toBe(preview);
});
