import { test, expect, type Page } from "@playwright/test";
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

async function expectOneSelectedMatchingInspector(page: Page) {
  await expect(page.locator(".swatch.selected")).toHaveCount(1);
  await expect(page.locator('.swatch-select[aria-pressed="true"]')).toHaveCount(
    1,
  );
  const label = await page
    .locator(".swatch.selected .swatch-select")
    .getAttribute("aria-label");
  const hex = label!.split(", ").pop()!;
  await expect(page.locator(".inspector button").first()).toHaveAttribute(
    "aria-label",
    `Copy ${hex} from inspector`,
  );
}

test("on load exactly one swatch is selected and it is the inspector's color", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expectOneSelectedMatchingInspector(page);

  await page.getByLabel("Sort palette", { exact: true }).selectOption("hue");
  await expectOneSelectedMatchingInspector(page);
});

test("the selection survives the selected color going away", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.locator(".swatch-select").last().click();
  await expectOneSelectedMatchingInspector(page);

  await page.getByRole("button", { name: "Fewer colors", exact: true }).click();
  await ready(page);
  await expectOneSelectedMatchingInspector(page);

  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await ready(page);
  await expectOneSelectedMatchingInspector(page);
});

test("a shared one-color palette still shows its selection", async ({
  page,
}) => {
  await page.goto("/#p=ee5533");
  await ready(page);
  await expect(page.locator(".swatch")).toHaveCount(1);
  await expectOneSelectedMatchingInspector(page);
});

test("the cube control is an action that matches what the cube is doing", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("tab", { name: "How it works" }).click();
  await expect(
    page.getByText("LIVE EXTRACTION TRACE", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Static view" })).toHaveCount(
    0,
  );

  await page
    .getByRole("button", { name: "Stop animation", exact: true })
    .click();
  await expect(page.getByText("STATIC VIEW", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByText("LIVE EXTRACTION TRACE", { exact: true }),
  ).toBeVisible();
});

test("with reduced motion the cube is static and offers no animation control", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await ready(page);
  await page.getByRole("tab", { name: "How it works" }).click();
  await expect(page.getByText("STATIC VIEW", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /animation/ })).toHaveCount(0);
});

const cssColorToHex = (value: string) =>
  "#" +
  value
    .match(/\d+/g)!
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("");

test("the export header shows the palette's own colors in export order", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("tab", { name: "Export palette" }).click();
  await page.getByLabel("Export format", { exact: true }).selectOption("css");
  const code = await page.locator("pre code").innerText();
  const exported = [...code.matchAll(/#[0-9a-f]{6}/gi)].map((m) =>
    m[0].toLowerCase(),
  );
  const chips = await page
    .locator(".code-heading i")
    .evaluateAll((nodes) =>
      nodes.map((n) => getComputedStyle(n).backgroundColor),
    );
  expect(exported).toHaveLength(6);
  expect(chips.map(cssColorToHex)).toEqual(exported);
  // With room to spare the chips stay square; they only narrow when tight.
  const widths = await page
    .locator(".code-chips i")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width));
  expect(widths).toEqual(widths.map(() => 10));
});

test("a one-color palette gets exactly one export chip", async ({ page }) => {
  await page.goto("/#p=ee5533");
  await ready(page);
  await page.getByRole("tab", { name: "Export palette" }).click();
  await expect(page.locator(".code-heading i")).toHaveCount(1);
});

test("the export header fits a narrow phone even at ten colors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await ready(page);
  for (let n = await page.locator(".swatch").count(); n < 10; n++) {
    await page
      .getByRole("button", { name: "More colors", exact: true })
      .click();
    await expect(page.locator(".swatch")).toHaveCount(n + 1);
  }
  await ready(page);
  await page.getByRole("tab", { name: "Export palette" }).click();
  await expect(page.locator(".code-chips i")).toHaveCount(10);
  for (const format of ["css", "tailwind", "scss", "svg", "json"]) {
    await page
      .getByLabel("Export format", { exact: true })
      .selectOption(format);
    const overflow = await page
      .locator(".code-heading")
      .evaluate((heading) => heading.scrollWidth - heading.clientWidth);
    expect(overflow, format).toBeLessThanOrEqual(0);
  }
});

for (const width of [390, 360, 320]) {
  test(`the identity footer sits on two clean rows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await ready(page);
    const layout = await page.locator(".brand-bottom").evaluate((footer) => {
      const [tagline, dots, study] = Array.from(footer.children);
      const lineCount = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set(
          Array.from(range.getClientRects(), (r) => Math.round(r.top)),
        ).size;
      };
      const box = (el: Element) => el.getBoundingClientRect();
      const middle = (el: Element) => box(el).top + box(el).height / 2;
      return {
        taglineLines: lineCount(tagline),
        studyLines: lineCount(study),
        dotsBelowTagline: box(dots).top >= box(tagline).bottom - 1,
        studyBesideDots: Math.abs(middle(study) - middle(dots)) < 4,
      };
    });
    expect(layout).toEqual({
      taglineLines: 1,
      studyLines: 1,
      dotsBelowTagline: true,
      studyBesideDots: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
