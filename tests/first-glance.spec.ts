import { test, expect, type Page } from "@playwright/test";
import { imageSize, ready } from "./helpers";

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

const RETIRED_COPY = [
  "AN IMAGE. A PALETTE. A POSSIBILITY.",
  "FROM SWATCHES TO SOMETHING",
  "A LITTLE MORE CONTRAST",
  "BEAUTIFUL IS ONLY THE BEGINNING",
  "THE METHOD BEHIND THE MOOD",
  "READY FOR YOUR NEXT PROJECT",
  "Good color.",
];
const TABS = ["In context", "Contrast check", "How it works", "Export palette"];

test("no filler eyebrows or em dashes on any tab, and the export heading says what you get", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab }).click();
    const text = await page.locator("body").innerText();
    for (const phrase of RETIRED_COPY) expect(text, tab).not.toContain(phrase);
    expect(text, `${tab} has an em dash`).not.toContain("\u2014");
  }
  await expect(page.locator(".eyebrow")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: "Paste-ready in 5 formats." }),
  ).toBeVisible();

  // The low-contrast variant of the identity panel had its own eyebrow.
  // Changing only the hash keeps the open tab, so return to the identity panel.
  await page.goto("/#p=777777.787878");
  await ready(page);
  await page.getByRole("tab", { name: "In context" }).click();
  await expect(
    page.getByText("They need a partner.", { exact: false }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(
    "A LITTLE MORE CONTRAST",
  );
});

// Secondary metadata may use a smaller mono size; everything else is
// supporting text. Illustrations draw their own type and are exempt.
const METADATA =
  ".swatch-select, .section-label h2 > span, .section-label h2 b, .tab-tag, .step-list b, .cube-topline, .cube-bottomline, .cube-legend, .code-heading, .image-caption a";
const ILLUSTRATION = ".sr-only, .brand-preview, .low-contrast-art";

for (const width of [1440, 1024, 900, 851]) {
  test(`desktop text stays at 13px or more at ${width}px, values stay whole`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    const problems = new Set<string>();
    for (const tab of TABS) {
      await page.getByRole("tab", { name: tab }).click();
      for (const format of ["HEX", "RGB", "HSL"]) {
        await page.getByRole("button", { name: format, exact: true }).click();
        const found = await page.evaluate(
          ({ METADATA, ILLUSTRATION }) => {
            const out: string[] = [];
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const text = n.textContent!.trim();
              const el = n.parentElement!;
              if (!text || el.closest(ILLUSTRATION)) continue;
              const box = el.getBoundingClientRect();
              if (!box.width || !box.height) continue;
              const size = parseFloat(getComputedStyle(el).fontSize);
              const min = el.closest(METADATA) ? 11 : 13;
              if (size < min)
                out.push(`${size}px "${text.slice(0, 24)}" (${el.className})`);
            }
            for (const select of document.querySelectorAll("select"))
              if (
                select.getBoundingClientRect().width &&
                parseFloat(getComputedStyle(select).fontSize) < 13
              )
                out.push(`select ${select.getAttribute("aria-label")}`);
            for (const button of document.querySelectorAll(
              ".swatch-info button, .inspector button",
            ))
              if (button.scrollWidth > button.clientWidth + 0.5)
                out.push(`clipped "${button.textContent!.trim()}"`);
            if (document.documentElement.scrollWidth > innerWidth)
              out.push("horizontal scroll");
            return out;
          },
          { METADATA, ILLUSTRATION },
        );
        found.forEach((p) => problems.add(`${tab}/${format}: ${p}`));
      }
    }
    expect([...problems]).toEqual([]);
  });
}

test("desktop lock and copy controls are large and clearly visible", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const lock = page.locator(".lock-button").first();
  const box = (await lock.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(36);
  expect(box.height).toBeGreaterThanOrEqual(36);
  expect(
    Number(await lock.evaluate((el) => getComputedStyle(el).opacity)),
  ).toBeGreaterThanOrEqual(0.9);
  const copy = (await page
    .locator(".swatch-info button")
    .first()
    .boundingBox())!;
  expect(copy.height).toBeGreaterThanOrEqual(32);
});

test.describe("on a touch phone", () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true });

  test("the lock and copy controls are visible and easy to hit", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    const copy = (await page
      .locator(".swatch-info button")
      .first()
      .boundingBox())!;
    expect(copy.height).toBeGreaterThanOrEqual(32);
    const lock = page.locator(".lock-button").first();
    expect(
      Number(await lock.evaluate((el) => getComputedStyle(el).opacity)),
    ).toBeGreaterThanOrEqual(0.9);
    const box = (await lock.boundingBox())!;
    // 4px left of the visible circle, level with its center.
    const hit = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".lock-button"),
      { x: box.x - 4, y: box.y + box.height / 2 },
    );
    expect(hit).toBe(true);
  });
});

const SITE = "https://palette-extractor.samalbanese.workers.dev/";
const PREVIEW_TAGS = [
  "og:type",
  "og:site_name",
  "og:url",
  "og:title",
  "og:description",
  "og:image",
  "og:image:alt",
  "og:image:width",
  "og:image:height",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
];

test("link previews: every Open Graph and Twitter tag is present and the image is real", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const meta: Record<string, string> = await page.evaluate(() =>
    Object.fromEntries(
      Array.from(
        document.querySelectorAll("meta[property], meta[name]"),
        (m) => [
          m.getAttribute("property") ?? m.getAttribute("name"),
          m.getAttribute("content") ?? "",
        ],
      ),
    ),
  );
  for (const key of PREVIEW_TAGS) {
    expect(meta[key], key).toBeTruthy();
    expect(meta[key], `${key} has an em dash`).not.toContain("\u2014");
  }
  expect(meta["twitter:card"]).toBe("summary_large_image");
  expect(meta["og:url"]).toBe(SITE);
  expect(meta["og:image"].startsWith(SITE)).toBe(true);
  expect(meta["twitter:image"]).toBe(meta["og:image"]);

  const response = await request.get(new URL(meta["og:image"]).pathname);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/(png|jpeg)/);
  const bytes = await response.body();
  expect(bytes.length).toBeLessThan(300_000);
  expect(imageSize(bytes)).toEqual({ width: 1200, height: 630 });
  expect(meta["og:image:width"]).toBe("1200");
  expect(meta["og:image:height"]).toBe("630");
});

test("the manifest and touch icon resolve to real PNGs at their declared sizes", async ({
  page,
  request,
}) => {
  // Unknown paths fall back to the app page with a 200, so status alone
  // proves nothing; every check below decodes the actual bytes.
  const missing = await request.get("/no-such-icon.png");
  expect(missing.headers()["content-type"]).toContain("text/html");

  await page.goto("/");
  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  const touchHref = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  const themeColor = await page
    .locator('meta[name="theme-color"]')
    .getAttribute("content");

  const manifest = await (await request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({
    name: "Palette Extractor",
    short_name: "Palette",
    start_url: "/",
    display: "standalone",
    theme_color: themeColor,
    background_color: themeColor,
  });
  const icons: { src: string; sizes: string }[] = [
    ...manifest.icons,
    { src: touchHref!, sizes: "180x180" },
  ];
  expect(icons.map((i) => i.sizes).sort()).toEqual([
    "180x180",
    "192x192",
    "512x512",
  ]);
  for (const icon of icons) {
    const response = await request.get(icon.src);
    expect(response.headers()["content-type"], icon.src).toBe("image/png");
    const { width, height } = imageSize(await response.body());
    expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
  }
});
