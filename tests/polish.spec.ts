import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ready, settled } from "./helpers";
import { pixels } from "./atmosphere-checks";

type Box = { left: number; top: number; right: number; bottom: number };

const intersects = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.html),
    })),
  ).toEqual([]);
}

async function chooseSample(page: Page, name: string) {
  await page.getByRole("button", { name: `Try ${name}` }).click();
  await expect(
    page.getByRole("button", { name: `Try ${name}` }),
  ).toHaveAttribute("aria-pressed", "true");
  await ready(page);
  await expect(page.locator(".image-caption > span").first()).toHaveText(name);
}

async function setCount(page: Page, target: number) {
  const output = page.locator(".count-control output");
  for (;;) {
    const count = Number(await output.innerText());
    if (count === target) break;
    await page
      .getByRole("button", {
        name: count < target ? "More colors" : "Fewer colors",
      })
      .click();
    await expect(output).toHaveText(
      String(count < target ? count + 1 : count - 1),
    );
    await ready(page);
  }
  await expect(page.locator(".swatch")).toHaveCount(target);
}

test("no color name repeats, and the swatches, inspector and JSON export agree", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await chooseSample(page, "Forest floor");
  const names = await page.locator(".swatch-info > span").allInnerTexts();
  expect(names).toHaveLength(6);
  expect(new Set(names).size).toBe(6);

  for (const index of [0, 3, 5]) {
    await page.locator(".swatch-select").nth(index).click();
    await expect(page.locator(".inspector > span")).toHaveText(names[index]);
  }

  await page.getByRole("tab", { name: "Export palette" }).click();
  await page.getByLabel("Export format", { exact: true }).selectOption("json");
  const exported = JSON.parse(await page.locator("pre code").innerText()) as {
    name: string;
  }[];
  expect(exported.map((entry) => entry.name)).toEqual(names);
});
