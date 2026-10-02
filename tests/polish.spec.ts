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

for (const width of [320, 390]) {
  test(`the hero subtitle never leaves one word alone at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const lines = await page.locator(".intro p").evaluate((p) => {
      const text = p.firstChild!;
      const words: { word: string; top: number }[] = [];
      const pattern = /\S+/g;
      for (
        let m = pattern.exec(text.textContent!);
        m;
        m = pattern.exec(text.textContent!)
      ) {
        const range = document.createRange();
        range.setStart(text, m.index);
        range.setEnd(text, m.index + m[0].length);
        words.push({
          word: m[0],
          top: Math.round(range.getBoundingClientRect().top),
        });
      }
      const byLine = new Map<number, string[]>();
      for (const { word, top } of words)
        byLine.set(top, [...(byLine.get(top) ?? []), word]);
      return [...byLine.values()];
    });
    for (const line of lines)
      expect(line.length, lines.join(" / ")).toBeGreaterThan(1);
  });
}

test("the upload button carries no external-link arrow", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const upload = page.getByRole("button", { name: "Upload image" });
  await expect(upload).toBeVisible();
  await expect(upload).not.toContainText("↗");
  await expect(upload.locator(".shortcut")).toHaveCount(0);
});

for (const width of [390, 768, 1440]) {
  test(`the sticker text stays inside its circle at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    await settled(page);
    const sticker = page.locator(".brand-sticker");
    await sticker.scrollIntoViewIfNeeded();
    // Rotation turns about the center, so it cannot move text in or out of
    // the circle; take it off and paint the text and disc in pure colors
    // with nothing else around them.
    await page.addStyleTag({
      content: `
        .brand-preview, .brand-preview * { visibility: hidden !important; }
        .brand-preview .brand-sticker {
          visibility: visible !important;
          transform: none !important;
          background: #0000ff !important;
          color: #ff0000 !important;
        }`,
    });
    const box = (await sticker.boundingBox())!;
    const pad = 12;
    const shot = await pixels(page, context, {
      clip: {
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
      },
    });
    const radius = box.width / 2;
    const cx = shot.width / 2;
    const cy = shot.height / 2;
    let ink = 0;
    let farthest = 0;
    for (let y = 0; y < shot.height; y++)
      for (let x = 0; x < shot.width; x++) {
        const i = (y * shot.width + x) * 4;
        const [r, g, b] = [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
        // Text ink: red, not the disc's blue or the dark page behind it.
        if (r < 140 || g > 90 || b > 120) continue;
        ink++;
        farthest = Math.max(farthest, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
      }
    expect(ink).toBeGreaterThan(50);
    // A clear ring of disc between the ink and the edge.
    expect(farthest).toBeLessThanOrEqual(radius - 5);
  });
}

for (const width of [768, 1440]) {
  test(`no count from 4 to 10 leaves a lone swatch on the last row at ${width}px`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await ready(page);
    for (const count of [4, 5, 6, 7, 8, 9, 10]) {
      await setCount(page, count);
      await settled(page);
      const rows = await page.locator(".swatch").evaluateAll((swatches) => {
        const tops = new Map<number, number>();
        for (const swatch of swatches) {
          const top = Math.round(swatch.getBoundingClientRect().top);
          tops.set(top, (tops.get(top) ?? 0) + 1);
        }
        return [...tops.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
      });
      expect(
        rows.reduce((a, b) => a + b),
        `${count}`,
      ).toBe(count);
      expect(
        rows.at(-1),
        `${count} colors: rows ${rows.join("/")}`,
      ).toBeGreaterThanOrEqual(2);
      // Values stay whole in every swatch.
      const clipped = await page
        .locator(".swatch-info button")
        .evaluateAll(
          (buttons) =>
            buttons.filter((b) => b.scrollWidth > b.clientWidth + 0.5).length,
        );
      expect(clipped, `${count} colors`).toBe(0);
    }
    await settled(page);
    await axeClean(page);
  });
}

for (const width of [390, 768, 1440]) {
  test(`the polished panels pass axe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await ready(page);
    await chooseSample(page, "Forest floor");
    await settled(page);
    await axeClean(page);
    for (const tab of ["Contrast check", "How it works", "In context"]) {
      await page.getByRole("tab", { name: tab }).click();
      await settled(page);
      await axeClean(page);
    }
  });
}
