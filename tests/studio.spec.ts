import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function ready(page: Page) {
  await expect(page.locator("#workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".swatch").first()).toBeVisible();
}
const svg = (color: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/></svg>`,
  );

test("complete first-run studio loads without external requests or browser errors", async ({
  page,
}) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && !request.url().includes("127.0.0.1"))
      external.push(request.url());
  });
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".swatch")).toHaveCount(6);
  await expect(page.locator(".brand-preview")).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("file upload, monochrome sharing, invalid files and retained palette", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await ready(page);
  await page.locator("input[type=file]").setInputFiles({
    name: "one-color.svg",
    mimeType: "image/svg+xml",
    buffer: svg("#ee5533"),
  });
  await ready(page);
  await expect(page.locator(".swatch")).toHaveCount(1);
  await expect(
    page.getByText("This image has fewer distinct colors than requested.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("#p=ee5533");
  await page.goto(link);
  await ready(page);
  await expect(page.locator(".swatch")).toHaveCount(1);
  await expect(
    page.getByText("The original image stays private.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "More colors", exact: true }),
  ).toBeDisabled();
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not image"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose an image file");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Your last palette is still available",
  );
  await expect(page.locator(".swatch")).toHaveCount(1);
});

test("copy formats, sort, locking and count preserve the user palette", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await ready(page);
  const copyButton = page.locator(".swatch-info button").first();
  const value = await copyButton.innerText();
  await copyButton.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  await page.getByRole("button", { name: "RGB", exact: true }).click();
  await expect(page.locator(".swatch-info button").first()).toContainText(
    "rgb(",
  );
  await page.getByRole("button", { name: "HSL", exact: true }).click();
  await expect(page.locator(".swatch-info button").first()).toContainText(
    "hsl(",
  );
  await page.getByRole("button", { name: "HEX", exact: true }).click();
  const hex = (await page
    .locator(".swatch-info button")
    .first()
    .getAttribute("aria-label"))!.replace("Copy ", "");
  await page.locator(".lock-button").first().click();
  await ready(page);
  await expect(
    page.getByRole("button", { name: `Unlock ${hex}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "More colors", exact: true }).click();
  await ready(page);
  await page.getByLabel("Sort palette", { exact: true }).selectOption("hue");
  await expect(
    page.getByRole("button", { name: `Unlock ${hex}`, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".palette-hint").first()).toContainText(
    "Distribution is hidden",
  );
  await page.getByRole("button", { name: "Unlock all", exact: true }).click();
  await ready(page);
  await expect(page.locator(".palette-hint").first()).toContainText(
    "Bar widths",
  );
});

test("each export format previews and downloads the same valid content", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await ready(page);
  await page.getByRole("tab", { name: "Export palette" }).click();
  for (const format of ["css", "tailwind", "scss", "svg", "json"]) {
    await page
      .getByLabel("Export format", { exact: true })
      .selectOption(format);
    const code = await page.locator("pre code").innerText();
    await page
      .locator(".export-panel")
      .getByRole("button", { name: /Copy code|Copied/, exact: true })
      .click();
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())).replace(
        /\r\n/g,
        "\n",
      ),
    ).toBe(code);
    if (format === "json") expect(JSON.parse(code)).toHaveLength(6);
    if (format === "tailwind") expect(code).toContain("@theme {");
    if (format === "svg") expect(code).toContain("<svg");
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("palette.json");
  const card = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PNG", exact: true }).click();
  expect((await card).suggestedFilename()).toMatch(/^palette-.+\.png$/);
});

test("algorithm and contrast tools work with keyboard tabs and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await ready(page);
  await page.getByRole("tab", { name: "In context" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Contrast check" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".contrast-pair").first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "How it works" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("STATIC VIEW", { exact: true })).toBeVisible();
  await expect(page.locator(".algorithm-canvas canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toHaveCount(0);
});

test("changing samples quickly keeps the final selection and transparent uploads fail cleanly", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await page.getByRole("button", { name: "Try Coastal color" }).click();
  await ready(page);
  await expect(page.locator(".image-caption")).toContainText("Coastal color");
  await page.locator("input[type=file]").setInputFiles({
    name: "empty.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    ),
  });
  await expect(page.getByRole("alert")).toContainText("fully transparent");
  await expect(page.locator(".image-caption")).toContainText("Coastal color");
});

for (const width of [390, 768, 1440]) {
  test(`responsive layout and accessibility at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const tab of [
      "In context",
      "Contrast check",
      "How it works",
      "Export palette",
    ]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
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
  });
}

test("drop and clipboard images stay local; an image URL can be loaded explicitly", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#225588"/></svg>',
        ],
        "dropped.svg",
        { type: "image/svg+xml" },
      ),
    );
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: data, bubbles: true }),
    );
  });
  await ready(page);
  await expect(page.locator(".image-caption")).toContainText("dropped.svg");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#552288"/></svg>',
        ],
        "pasted.svg",
        { type: "image/svg+xml" },
      ),
    );
    window.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });
  await ready(page);
  await expect(page.locator(".image-caption")).toContainText("pasted.svg");
  await page.route("https://example.com/palette.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: svg("#88bb33"),
    }),
  );
  await page.getByRole("button", { name: "Use URL", exact: true }).click();
  await page
    .getByLabel("Public image URL")
    .fill("https://example.com/palette.svg");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await ready(page);
  await expect(page.locator(".swatch-info")).toContainText("#88bb33");
});

test("all pinned colors survive count limits and simple palettes explain low contrast", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Fewer colors", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "Fewer colors", exact: true }).click();
  await ready(page);
  for (let i = 0; i < 4; i++) {
    await page
      .getByRole("button", { name: /^Lock #/ })
      .first()
      .click();
    await ready(page);
  }
  await expect(
    page.getByRole("button", { name: "Fewer colors", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".lock-button[aria-pressed=true]")).toHaveCount(4);
  await page.getByRole("button", { name: "More colors", exact: true }).click();
  await ready(page);
  await expect(page.locator(".lock-button[aria-pressed=true]")).toHaveCount(4);
  await page.goto("/#p=777777.787878");
  await ready(page);
  await expect(
    page.getByText("They need a partner.", { exact: false }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("long RGB and HSL values fit a narrow phone without hiding copy controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await ready(page);
  for (const format of ["HEX", "RGB", "HSL"]) {
    await page.getByRole("button", { name: format, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".swatch-info button")
        .evaluateAll((nodes) =>
          nodes.every((node) => node.scrollWidth <= node.clientWidth),
        ),
    ).toBe(true);
  }
});
