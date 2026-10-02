import { test, expect, type Page } from "@playwright/test";
import { ready } from "./helpers";
import { host } from "./stage-checks";

const PHONE = { width: 390, height: 844 };

/** The intro has finished and no swatch is still entering. */
async function atRest(page: Page) {
  await expect(host(page)).toHaveAttribute("data-stage-phase", "done", {
    timeout: 15000,
  });
  await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/);
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

/** Each swatch's box, whether every ancestor shows it whole, and whether a
    tap at its copy button's center reaches that button. */
function swatchReport(page: Page) {
  return page.locator(".swatch").evaluateAll((swatches) =>
    swatches.map((swatch) => {
      const box = swatch.getBoundingClientRect();
      const clippedBy: string[] = [];
      for (
        let el = swatch.parentElement;
        el && el !== document.documentElement;
        el = el.parentElement
      ) {
        const style = getComputedStyle(el);
        const clips =
          style.overflowX !== "visible" ||
          style.overflowY !== "visible" ||
          style.clipPath !== "none";
        if (!clips) continue;
        const r = el.getBoundingClientRect();
        if (
          box.left < r.left - 0.5 ||
          box.right > r.right + 0.5 ||
          box.top < r.top - 0.5 ||
          box.bottom > r.bottom + 0.5
        )
          clippedBy.push(el.className || el.tagName);
      }
      const copy = swatch.querySelector<HTMLElement>(".swatch-info button")!;
      const c = copy.getBoundingClientRect();
      const hit = document.elementFromPoint(
        c.left + c.width / 2,
        c.top + c.height / 2,
      );
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        copyBottom: c.bottom,
        clippedBy,
        reachable: !!hit && copy.contains(hit),
      };
    }),
  );
}

test.describe("phone layout", () => {
  test.use({ viewport: PHONE });

  test("the stage and every default swatch fit the first screen", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await atRest(page);
    await expect(page.locator(".swatch")).toHaveCount(6);
    await expect(
      page.getByRole("button", { name: "HEX", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const swatches = await swatchReport(page);
    const lowest = Math.max(...swatches.map((s) => s.copyBottom));
    console.log(
      `PHONE_LAST_COPY_BOTTOM ${lowest.toFixed(1)} spare ${(PHONE.height - lowest).toFixed(1)}`,
    );
    for (const [i, s] of swatches.entries()) {
      expect(s.left, `swatch ${i + 1} left`).toBeGreaterThanOrEqual(0);
      expect(s.right, `swatch ${i + 1} right`).toBeLessThanOrEqual(PHONE.width);
      expect(s.top, `swatch ${i + 1} top`).toBeGreaterThanOrEqual(0);
      expect(s.bottom, `swatch ${i + 1} bottom`).toBeLessThanOrEqual(
        PHONE.height,
      );
      expect(s.clippedBy, `swatch ${i + 1} clipped`).toEqual([]);
      expect(s.reachable, `swatch ${i + 1} copy button`).toBe(true);
    }
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });

  test("ten colors in rgb() stay usable by scrolling", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await ready(page);
    for (let count = 7; count <= 10; count++) {
      await page
        .getByRole("button", { name: "More colors", exact: true })
        .click();
      await ready(page);
      await expect(page.locator(".swatch")).toHaveCount(count);
    }
    await page.getByRole("button", { name: "RGB", exact: true }).click();
    const copies = page.locator(".swatch-info button");
    for (let i = 0; i < 10; i++) {
      const copy = copies.nth(i);
      await copy.scrollIntoViewIfNeeded();
      expect(
        await copy.evaluate((button) => {
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return (
            r.left >= 0 &&
            r.right <= innerWidth &&
            button.scrollWidth <= button.clientWidth + 0.5 &&
            !!hit &&
            button.contains(hit)
          );
        }),
        `copy button ${i + 1}`,
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test("upload, moods and the drop/URL row render once, below the palette", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    await expect(page.locator(".upload-main")).toHaveCount(1);
    await expect(page.locator(".sample-row")).toHaveCount(1);
    await expect(page.locator(".source-actions")).toHaveCount(1);
    await expect(page.locator(".intro .upload-main")).toHaveCount(0);
    const order = await page.evaluate(() => {
      const moved = document.querySelector(".phone-source-controls")!;
      const follows = (a: Element, b: Element) =>
        !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        holds: [".upload-main", ".sample-row", ".source-actions"].every(
          (selector) => !!moved.querySelector(selector),
        ),
        afterHint: follows(document.querySelector(".palette-hint")!, moved),
        beforeDock: follows(moved, document.querySelector(".palette-dock")!),
      };
    });
    expect(order).toEqual({ holds: true, afterHint: true, beforeDock: true });
    // Replace stays in the source row as the upload path above the fold.
    const replace = page
      .locator(".source-panel > .section-label")
      .getByRole("button", { name: "Replace" });
    await expect(replace).toBeInViewport();
  });

  test("tab order follows the phone's visual order", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await atRest(page);
    const visited: { group: string; name: string }[] = [];
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const group =
          el.matches(".skip-link") || el.closest(".site-header")
            ? "header"
            : el.closest(".source-panel > .section-label")
              ? "source row"
              : el.closest(".source-frame")
                ? "stage"
                : el.closest(".palette-panel")
                  ? "palette"
                  : el.closest(".phone-source-controls")
                    ? "moved"
                    : "after";
        const name = (
          el.getAttribute("aria-label") ??
          el.closest("label")?.textContent ??
          el.textContent ??
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        return { group, name, last: el.matches(".site-footer a") };
      });
      if (!stop) continue;
      visited.push({ group: stop.group, name: stop.name });
      if (stop.last) break;
    }
    const groups = visited
      .map((v) => v.group)
      .filter((g, i, all) => g !== all[i - 1]);
    expect(groups).toEqual([
      "header",
      "source row",
      "stage",
      "palette",
      "moved",
      "after",
    ]);
    const names = (group: string) =>
      visited.filter((v) => v.group === group).map((v) => v.name);
    expect(names("header")).toEqual([
      "Skip to color workspace",
      "Palette Extractor home",
      "View source",
    ]);
    expect(names("source row")).toEqual(["RGB", "Replace"]);
    expect(names("stage")).toEqual(
      expect.arrayContaining(["Photo", "Color space"]),
    );
    const palette = names("palette");
    for (const format of ["HEX", "RGB", "HSL"])
      expect(palette).toContain(format);
    const copies = await page
      .locator(".swatch-info button")
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute("aria-label")!.trim()),
      );
    expect(copies).toHaveLength(6);
    for (const copy of copies) expect(palette).toContain(copy);
    expect(names("moved")).toEqual([
      "Upload image ↗",
      "Try Golden dunes",
      "Try Forest floor",
      "Try Coastal color",
      "Use URL",
    ]);
    // Every link on the page stays reachable by keyboard.
    const links = await page
      .locator("a[href]:visible")
      .evaluateAll((anchors) =>
        anchors.map((a) =>
          (a.getAttribute("aria-label") ?? a.textContent ?? "").trim(),
        ),
      );
    const reached = visited.map((v) => v.name);
    for (const link of links) expect(reached).toContain(link);
  });
});

test("text typed in the URL field survives crossing the phone breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".intro .upload-main")).toHaveCount(1);
  await page.getByRole("button", { name: "Use URL", exact: true }).click();
  const typed = "https://example.com/rotated.jpg";
  await page.getByLabel("Public image URL").fill(typed);
  await expect(page.locator(".source-panel #image-url")).toHaveCount(1);

  await page.setViewportSize(PHONE);
  await expect(page.locator(".phone-source-controls #image-url")).toHaveValue(
    typed,
  );
  await expect(page.locator("#image-url")).toHaveCount(1);
  await expect(page.locator(".upload-main")).toHaveCount(1);
  await expect(page.locator(".intro .upload-main")).toHaveCount(0);

  await page.setViewportSize({ width: 581, height: 900 });
  await expect(page.locator(".source-panel #image-url")).toHaveValue(typed);
  await expect(page.locator("#image-url")).toHaveCount(1);
  await expect(page.locator(".phone-source-controls")).toHaveCount(0);
  await expect(page.locator(".intro .upload-main")).toHaveCount(1);
});
