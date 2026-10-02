import { test, expect, type Page } from "@playwright/test";
import { ready, stageDone, svg } from "./helpers";

const space = (page: Page, name: "RGB" | "Perceptual") =>
  page.getByRole("radio", { name, exact: true });
const line = (page: Page) => page.locator(".color-comparison");
const liveRegion = (page: Page) =>
  page.locator('span.sr-only[aria-live="polite"]');

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Both heading rows: whether each stays on one line, inside its row and the
    viewport, unclipped and clear of its neighbors. */
function headings(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const rect = (el: Element) => el.getBoundingClientRect();
    const name = (el: Element) => el.className || el.tagName;
    for (const row of document.querySelectorAll<HTMLElement>(
      ".workspace .section-label",
    )) {
      const r = rect(row);
      if (r.left < -0.5 || r.right > innerWidth + 0.5)
        problems.push(`${row.parentElement!.className} leaves the viewport`);
      if (row.scrollWidth > row.clientWidth + 0.5)
        problems.push(`${row.parentElement!.className} overflows`);
      const kids = [...row.children];
      kids.forEach((kid, i) => {
        const k = rect(kid);
        if (k.left < r.left - 0.5 || k.right > r.right + 0.5)
          problems.push(`${name(kid)} sticks out of its row`);
        for (const el of [kid, ...kid.querySelectorAll("*")])
          if (
            !el.matches(".sr-only, .sr-only *") &&
            (el as HTMLElement).scrollWidth >
              (el as HTMLElement).clientWidth + 0.5
          )
            problems.push(`${name(el)} is clipped`);
        const next = kids[i + 1];
        if (next && rect(next).left < k.right - 0.5)
          problems.push(`${name(kid)} overlaps ${name(next)}`);
      });
    }
    return problems;
  });
}

for (const width of [390, 580, 581, 699, 700, 768, 850, 851, 1440])
  test(`the color space switch sits beside Replace at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    const group = page.getByRole("group", { name: "Color space" });
    await expect(group).toBeVisible();
    await expect(group).toBeInViewport();
    const row = await page.evaluate(() => {
      const row = document.querySelector(".source-panel > .section-label")!;
      const [title, fieldset, replace] = [...row.children].map((el) =>
        el.getBoundingClientRect(),
      );
      const centers = [title, fieldset, replace].map(
        (r) => r.top + r.height / 2,
      );
      const legend = row.querySelector("legend")!.getBoundingClientRect();
      return {
        order: [...row.children].map((el) => el.tagName),
        replaceText: row.lastElementChild!.textContent!.trim(),
        spread: Math.max(...centers) - Math.min(...centers),
        gap: replace.left - fieldset.right,
        legendHidden: legend.width <= 1 && legend.height <= 1,
      };
    });
    expect(row.order).toEqual(["H2", "FIELDSET", "BUTTON"]);
    expect(row.replaceText).toBe("Replace");
    expect(row.spread).toBeLessThanOrEqual(2);
    expect(row.gap).toBeGreaterThanOrEqual(0);
    expect(row.gap).toBeLessThanOrEqual(24);
    expect(row.legendHidden).toBe(true);
    expect(await headings(page)).toEqual([]);

    await space(page, "Perceptual").check();
    await ready(page);
    await expect(line(page)).toHaveText(/^\d+ of \d+ colors changed$/);
    expect(await headings(page)).toEqual([]);
    // The longest report must fit the reserved line too.
    const room = await line(page).evaluate((p) => {
      const probe = p.cloneNode() as HTMLElement;
      probe.textContent = "10 of 10 colors changed";
      probe.style.cssText = "position:absolute;width:auto;visibility:hidden";
      p.parentElement!.append(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();
      return { needed, available: p.clientWidth };
    });
    expect(room.needed).toBeLessThanOrEqual(room.available);
  });

for (const width of [390, 580, 581, 699, 700, 768, 850, 851, 1440])
  test(`the workspace uses ${width < 700 ? "one column" : "two aligned columns"} at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await ready(page);
    const layout = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      return {
        source: box(".source-panel"),
        palette: box(".palette-panel"),
        sourceHeading: box(".source-panel > .section-label").height,
        paletteHeading: box(".palette-panel > .section-label").height,
        frameTop: box(".source-frame").top,
        gridTop: box(".swatch-grid").top,
        titleLine: box(".palette-title h2").height,
        comparisonLine: box(".color-comparison").height,
        // Centers of the title line and of every header control.
        paletteCenters: [".palette-title h2", ".value-switch"].map((s) => {
          const r = box(`.palette-panel > .section-label ${s}`);
          return r.top + r.height / 2;
        }),
        sourceTitleCenter: (() => {
          const r = box(".source-panel > .section-label > h2");
          return r.top + r.height / 2;
        })(),
      };
    });
    expect(layout.titleLine).toBe(23);
    expect(layout.comparisonLine).toBe(18);
    expect(layout.paletteHeading).toBe(41);
    // The palette's controls sit on its title line, not midway down the row
    // that also holds the comparison line.
    expect(
      Math.abs(layout.paletteCenters[0] - layout.paletteCenters[1]),
    ).toBeLessThanOrEqual(1);
    if (width < 700) {
      expect(layout.palette.top).toBeGreaterThan(layout.source.bottom);
    } else {
      expect(layout.palette.left).toBeGreaterThan(layout.source.right);
      expect(layout.sourceHeading).toBe(layout.paletteHeading);
      expect(Math.abs(layout.frameTop - layout.gridTop)).toBeLessThanOrEqual(
        0.5,
      );
      // Side by side, the two section titles share one line.
      expect(
        Math.abs(layout.sourceTitleCenter - layout.paletteCenters[0]),
      ).toBeLessThanOrEqual(0.5);
    }
  });

/** Every element in the workspace outside the stage, by position. The
    distribution bar's segments are sized by the palette itself, so they are
    left out when `withBar` is false (comparing two different palettes). */
function workspaceRects(page: Page, withBar = true) {
  return page.evaluate(
    (withBar) =>
      [...document.querySelectorAll(".workspace *")]
        .filter(
          (el) =>
            !el.closest(".stage-host") &&
            (withBar || !el.matches(".distribution > i")),
        )
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName} ${[r.x, r.y, r.width, r.height]
            .map((v) => v.toFixed(2))
            .join(",")}`;
        }),
    withBar,
  );
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
])
  test(`the comparison shows for six seconds without moving anything at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.clock.install();
    await page.goto("/");
    await ready(page);
    await stageDone(page);
    await expect(line(page)).toHaveText("");
    const before = await workspaceRects(page, false);

    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await space(page, "Perceptual").check();
    await ready(page);
    const shown = await line(page).innerText();
    const [, changed, total] = shown.match(/^(\d+) of (\d+) colors changed$/)!;
    expect(Number(total)).toBe(await page.locator(".swatch").count());
    // The announcement keeps its wording and agrees with the visible line.
    expect((await liveRegion(page).innerText()).trim()).toBe(
      changed === "0"
        ? "Same colors in both color spaces."
        : `Perceptual changed ${changed} of ${total} colors.`,
    );
    await expect(line(page)).not.toHaveAttribute("aria-live");
    await expect(line(page)).not.toHaveAttribute("role");
    expect(await workspaceRects(page, false)).toEqual(before);
    const during = await workspaceRects(page);

    await page.clock.runFor(5990);
    await expect(line(page)).toHaveText(shown);
    await page.clock.runFor(20);
    await expect(line(page)).toHaveText("");
    expect(await workspaceRects(page)).toEqual(during);
  });

test("the next switch replaces the comparison and restarts its six seconds", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await ready(page);
  await stageDone(page);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await space(page, "Perceptual").check();
  await ready(page);
  await expect(line(page)).toHaveText(/colors changed$/);
  await page.clock.runFor(3000);
  await space(page, "RGB").check();
  await ready(page);
  await expect(liveRegion(page)).toHaveText(
    /^(RGB changed \d+ of \d+ colors\.|Same colors in both color spaces\.)$/,
  );
  await expect(line(page)).toHaveText(/^\d+ of \d+ colors changed$/);
  // Past the first switch's six seconds, the second one still shows.
  await page.clock.runFor(4000);
  await expect(line(page)).toHaveText(/colors changed$/);
  await page.clock.runFor(2100);
  await expect(line(page)).toHaveText("");
});

test("any other palette change clears the comparison at once", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await ready(page);
  await stageDone(page);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await space(page, "Perceptual").check();
  await ready(page);
  await expect(line(page)).toHaveText(/colors changed$/);
  await page.getByRole("button", { name: "More colors", exact: true }).click();
  await ready(page);
  await expect(page.locator(".swatch")).toHaveCount(7);
  await expect(line(page)).toHaveText("");

  await space(page, "RGB").check();
  await ready(page);
  await expect(line(page)).toHaveText(/colors changed$/);
  await page.getByLabel("Sort palette").selectOption("luminance");
  await expect(line(page)).toHaveText("");
});

test("a switch that changes nothing still reports 0 of M", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.locator("input[type=file]").setInputFiles({
    name: "one-color.svg",
    mimeType: "image/svg+xml",
    buffer: svg("#ee5533"),
  });
  await ready(page);
  await expect(page.locator(".swatch")).toHaveCount(1);
  await expect(line(page)).toHaveText("");
  await space(page, "Perceptual").check();
  await ready(page);
  await expect(line(page)).toHaveText("0 of 1 colors changed");
  await expect(liveRegion(page)).toHaveText(
    "Same colors in both color spaces.",
  );
});
