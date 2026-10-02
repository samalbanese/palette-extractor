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

for (const width of [320, 390, 768, 1440]) {
  test(`contrast tiles keep "Aa" clear of the ratio and verdict at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("tab", { name: "Contrast check" }).click();
    await expect(page.locator(".contrast-pair").first()).toBeVisible();
    const tiles = await page
      .locator(".contrast-grid > li")
      .evaluateAll((items) =>
        items.map((item) => {
          const textBox = (node: Node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              lines: new Set(
                [...range.getClientRects()]
                  .filter((r) => r.width > 0)
                  .map((r) => Math.round(r.top)),
              ).size,
            };
          };
          const sample = item.querySelector(".contrast-sample")!;
          const aa = sample.querySelector(":scope > span:first-child")!;
          const ratio = sample.querySelector(".contrast-ratio");
          const verdict = sample.querySelector(".contrast-verdict");
          const tile = sample.getBoundingClientRect();
          return {
            text: (item as HTMLElement).innerText,
            tile: {
              left: tile.left,
              top: tile.top,
              right: tile.right,
              bottom: tile.bottom,
            },
            aa: textBox(aa),
            ratio: ratio && textBox(ratio),
            verdict: verdict && textBox(verdict),
          };
        }),
      );
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.ratio, tile.text).not.toBeNull();
      expect(tile.verdict, tile.text).not.toBeNull();
      expect(intersects(tile.aa, tile.ratio!), tile.text).toBe(false);
      expect(intersects(tile.aa, tile.verdict!), tile.text).toBe(false);
      expect(tile.verdict!.lines, tile.text).toBeLessThanOrEqual(2);
      // Every piece of text stays inside its tile.
      for (const box of [tile.aa, tile.ratio!, tile.verdict!]) {
        expect(box.left).toBeGreaterThanOrEqual(tile.tile.left);
        expect(box.right).toBeLessThanOrEqual(tile.tile.right);
        expect(box.top).toBeGreaterThanOrEqual(tile.tile.top);
        expect(box.bottom).toBeLessThanOrEqual(tile.tile.bottom);
      }
      // One verdict per tile, not one inside and another below.
      const verdicts = tile.text.match(/AAA|AA Large|Large text only|AA/g);
      expect(verdicts, tile.text).toHaveLength(1);
    }
  });
}

test("How it works counts one color group in the singular", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("tab", { name: "How it works" }).click();
  const slider = page.getByRole("slider", { name: "Split step" });
  await slider.press("Home");
  const stat = page.locator(".algorithm-stats > div").nth(1);
  await expect(stat.locator("strong")).toHaveText("1");
  await expect(stat.locator("span")).toHaveText("color group");
  await slider.press("ArrowRight");
  await expect(stat.locator("strong")).toHaveText("2");
  await expect(stat.locator("span")).toHaveText("color groups");
});

for (const space of ["RGB", "Perceptual"]) {
  test(`the How it works headings keep apart on a phone in ${space}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    if (space === "Perceptual") {
      await page.getByText("Perceptual", { exact: true }).click();
      await ready(page);
    }
    await page.getByRole("tab", { name: "How it works" }).click();
    await expect(page.locator(".cube-topline > span")).toHaveCount(2);
    const boxes = await page
      .locator(".cube-topline > span")
      .evaluateAll((spans) =>
        spans.map((span) => {
          const range = document.createRange();
          range.selectNodeContents(span);
          const r = range.getBoundingClientRect();
          return {
            text: span.textContent,
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          };
        }),
      );
    expect(boxes).toHaveLength(2);
    const [first, second] = boxes;
    expect(first.text).toContain(space === "RGB" ? "RGB" : "OKLAB");
    expect(intersects(first, second)).toBe(false);
    // Side by side they need a clear gap; stacked, a clear line gap.
    const apart = Math.max(
      second.left - first.right,
      second.top - first.bottom,
    );
    expect(apart).toBeGreaterThanOrEqual(12);
  });
}

test.describe("on a touch screen", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("tapping a sample leaves no tooltip over the controls", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    const sample = page.getByRole("button", { name: "Try Forest floor" });
    await sample.scrollIntoViewIfNeeded();
    await sample.tap();
    await ready(page);
    await expect(sample).toHaveAttribute("aria-pressed", "true");
    for (const tip of await page.locator(".sample-row button span").all())
      await expect(tip).toHaveCSS("opacity", "0");
  });
});

test("keyboard focus still shows a sample's name", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const sample = page.getByRole("button", { name: "Try Forest floor" });
  await sample.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(sample).toBeFocused();
  await expect(sample.locator("span")).toHaveCSS("opacity", "1");
});

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
