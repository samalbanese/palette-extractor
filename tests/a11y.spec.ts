import { readFileSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { contrastRatio } from "../src/lib/contrast";
import { ready, settled, stageDone } from "./helpers";
import {
  commit,
  openOnClock,
  pauseClock,
  pinAnimations,
  runTo,
  setHash,
  stopFrames,
} from "./morph-checks";
import { frozenFrame, holdFades, layers, pixels } from "./atmosphere-checks";

// Text on the page background, where the glow can sit under it, is proven
// readable by arithmetic in src/lib/atmosphere.test.ts; text over photos and
// canvases is checked here against the pixels it is drawn on. Run with
// UPDATE_A11Y_FIXTURES=1 to rewrite both lists from what the walk finds.
const ATMOSPHERE_FIXTURE = "tests/fixtures/atmosphere-text.json";
const IMAGE_FIXTURE = "tests/fixtures/image-text.json";
const UPDATE = !!process.env.UPDATE_A11Y_FIXTURES;

type TextEntry = {
  element: string;
  ink: string;
  layers: { background: string | null; opacity: number }[];
};
type NonTextEntry = { element: string; color: string; alpha: number };
type Walk = { text: TextEntry[]; nonText: NonTextEntry[] };

const committed = JSON.parse(readFileSync(ATMOSPHERE_FIXTURE, "utf8")) as Walk;
const imageText = JSON.parse(readFileSync(IMAGE_FIXTURE, "utf8")) as {
  elements: string[];
};

/**
 * Every visible text element whose first opaque background is the page
 * itself and that overlaps the glow, with its ink and the translucent layers
 * between it and the page (innermost first); and every outline drawn there.
 * Disabled controls are left out, as WCAG exempts inactive components.
 */
function walkPage(): Walk {
  const box = document.querySelector(".atmosphere")!.getBoundingClientRect();
  const overlaps = (r: DOMRect) =>
    r.width > 0 &&
    r.height > 0 &&
    r.right > box.left &&
    r.left < box.right &&
    r.bottom > box.top &&
    r.top < box.bottom;
  const name = (el: Element) => {
    const parts: string[] = [];
    for (
      let node: Element | null = el;
      node && node !== document.body && parts.length < 3;
      node = node.parentElement
    )
      parts.unshift(
        node.tagName.toLowerCase() +
          (node.classList[0] ? `.${node.classList[0]}` : ""),
      );
    return parts.join(" > ");
  };
  const alphaOf = (color: string) => {
    const values = color.match(/[\d.]+/g)!.map(Number);
    return values.length > 3 ? values[3] : 1;
  };
  // Null when something opaque, or an image, sits between `el` and the page.
  const layersUnder = (el: Element) => {
    const found: TextEntry["layers"] = [];
    for (
      let node: Element | null = el;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null;
      const alpha = alphaOf(style.backgroundColor);
      if (alpha >= 1) return null;
      const opacity = Number(style.opacity);
      if (alpha > 0 || opacity < 1)
        found.push({
          background: alpha > 0 ? style.backgroundColor : null,
          opacity,
        });
    }
    return found;
  };
  const shown = (el: Element) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    !el.closest(".sr-only, .atmosphere, :disabled");

  const text: TextEntry[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const hasText =
      el.matches("input, select, textarea") ||
      [...el.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
      );
    if (!hasText || !shown(el) || !overlaps(el.getBoundingClientRect()))
      continue;
    const found = layersUnder(el);
    if (found)
      text.push({
        element: name(el),
        ink: getComputedStyle(el).color,
        layers: found,
      });
  }
  const nonText: NonTextEntry[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (
      style.outlineStyle === "none" ||
      parseFloat(style.outlineWidth) === 0 ||
      !shown(el) ||
      !overlaps(el.getBoundingClientRect()) ||
      !el.parentElement ||
      !layersUnder(el.parentElement)
    )
      continue;
    let alpha = alphaOf(style.outlineColor);
    for (let node: Element | null = el; node; node = node.parentElement)
      alpha *= Number(getComputedStyle(node).opacity);
    nonText.push({ element: name(el), color: style.outlineColor, alpha });
  }
  return { text, nonText };
}

const union = new Map<string, TextEntry>();
const outlines = new Map<string, NonTextEntry>();
const key = (entry: object) => JSON.stringify(entry);

function record(found: Walk) {
  for (const entry of found.text) union.set(key(entry), entry);
  for (const entry of found.nonText) outlines.set(key(entry), entry);
}

const elementName = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector)!;
    const parts: string[] = [];
    for (
      let node: Element | null = el;
      node && node !== document.body && parts.length < 3;
      node = node.parentElement
    )
      parts.unshift(
        node.tagName.toLowerCase() +
          (node.classList[0] ? `.${node.classList[0]}` : ""),
      );
    return parts.join(" > ");
  }, selector);

/**
 * Axe on a frozen frame: no violations, and every contrast check axe could
 * not settle is text on the glow (in the committed walk) or text over an
 * image or canvas (in the image list, and checked against its pixels).
 */
async function scan(page: Page) {
  // The drag hint is judged where its fade-in settles: a frozen clock can
  // otherwise catch it half drawn.
  await page.evaluate(() =>
    document
      .querySelector(".stage-hint")
      ?.getAnimations()
      .forEach((a) => a.finish()),
  );
  // Axe yields between rules with zero-delay timeouts, which a paused page
  // clock never runs. For the scan only, those run on a message channel and
  // every longer timeout (axe's own guards, and the page's) waits, so the
  // frame stays frozen.
  await page.evaluate(() => {
    const w = window as unknown as { __clockTimeout?: typeof setTimeout };
    w.__clockTimeout = window.setTimeout;
    window.setTimeout = ((callback: () => void, delay?: number) => {
      if (!delay) {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => callback();
        channel.port2.postMessage(0);
      }
      return 0;
    }) as typeof setTimeout;
  });
  const { results, found } = await frozenFrame(page, async () => ({
    results: await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze(),
    found: await page.evaluate(walkPage),
  }));
  await page.evaluate(() => {
    const w = window as unknown as { __clockTimeout: typeof setTimeout };
    window.setTimeout = w.__clockTimeout;
  });
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.html),
    })),
  ).toEqual([]);
  record(found);
  const onGlow = new Set(found.text.map((entry) => entry.element));
  const unsettled = results.incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) => result.nodes.map((node) => String(node.target[0])));
  const overImages: string[] = [];
  for (const selector of unsettled) {
    const element = await elementName(page, selector);
    if (onGlow.has(element)) {
      expect(
        committed.text.some((entry) => entry.element === element) || UPDATE,
        `${element} sits on the glow but is not in the committed walk`,
      ).toBe(true);
      continue;
    }
    if (UPDATE) imageElements.add(element);
    else
      expect(
        imageText.elements,
        `${element} is neither on the glow nor in the image list`,
      ).toContain(element);
    overImages.push(selector);
  }
  for (const selector of overImages) await overImage(page, selector);
}

const imageElements = new Set<string>();

/**
 * Text drawn over a photo or canvas: with the text made transparent, every
 * pixel of its box keeps 4.5:1 (3:1 for large text) against its ink.
 */
async function overImage(page: Page, selector: string) {
  const target = page.locator(selector).first();
  const info = await target.evaluate((el: HTMLElement) => {
    const style = getComputedStyle(el);
    let alpha = 1;
    for (let node: Element | null = el; node; node = node.parentElement)
      alpha *= Number(getComputedStyle(node).opacity);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    return {
      ink: style.color,
      alpha,
      large: size >= 24 || (bold && size >= 18.66),
      inline: el.style.cssText,
    };
  });
  await target.evaluate((el: HTMLElement) =>
    el.style.setProperty("color", "transparent", "important"),
  );
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const shot = await pixels(page, page.context(), { clip: box });
  await target.evaluate(
    (el: HTMLElement, inline) => (el.style.cssText = inline),
    info.inline,
  );
  const [r, g, b, a = 1] = info.ink.match(/[\d.]+/g)!.map(Number);
  const alpha = a * info.alpha;
  let worst = Infinity;
  for (let i = 0; i < shot.data.length; i += 4) {
    const under = { r: shot.data[i], g: shot.data[i + 1], b: shot.data[i + 2] };
    const mix = (ink: number, bg: number) =>
      Math.round(ink * alpha + bg * (1 - alpha));
    const ink = { r: mix(r, under.r), g: mix(g, under.g), b: mix(b, under.b) };
    worst = Math.min(worst, contrastRatio(ink, under));
  }
  expect(worst, `${selector} over its image`).toBeGreaterThanOrEqual(
    info.large ? 3 : 4.5,
  );
}

test.describe.configure({ mode: "serial" });

for (const width of [390, 768, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
    });

    test("the glow at rest", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await ready(page);
      await settled(page);
      await expect(layers(page)).toHaveCount(1);
      await scan(page);
      await focusRings(page);
    });

    test("mid-morph, mid-crossfade on a shared palette", async ({ page }) => {
      await holdFades(page);
      await openOnClock(page, "/#p=000000.c04040.4060c0");
      await pauseClock(page);
      const start = await commit(page, () =>
        setHash(page, "#p=ffffff.c04040.4060c0"),
      );
      await runTo(page, start + 200);
      await stopFrames(page);
      await pinAnimations(page);
      await expect(layers(page)).toHaveCount(2);
      await scan(page);
    });

    test("a color space switch mid-crossfade, comparison showing", async ({
      page,
    }) => {
      await holdFades(page);
      await openOnClock(page, "/");
      await stageDone(page);
      await pauseClock(page);
      const start = await commit(page, () =>
        page.getByRole("radio", { name: "Perceptual", exact: true }).check(),
      );
      await runTo(page, start + 300);
      await stopFrames(page);
      await pinAnimations(page);
      await expect(page.locator(".color-comparison")).toHaveText(
        /^\d+ of \d+ colors changed$/,
      );
      await scan(page);
    });

    test("the comparison line at rest", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.clock.install();
      await page.goto("/");
      await ready(page);
      await settled(page);
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
      await page
        .getByRole("radio", { name: "Perceptual", exact: true })
        .check();
      await ready(page);
      await expect(page.locator(".color-comparison")).toHaveText(
        /^\d+ of \d+ colors changed$/,
      );
      await expect(layers(page)).toHaveCount(1);
      await scan(page);
    });

    test("How it works with the scrubber focused", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await ready(page);
      await settled(page);
      await page.getByRole("tab", { name: "How it works" }).click();
      const slider = page.getByRole("slider", { name: "Split step" });
      await slider.focus();
      await expect(slider).toBeFocused();
      const renderer = page.locator(".algorithm-renderer");
      await expect(renderer).toHaveAttribute("data-drawn-step", /\d/);
      expect(await renderer.getAttribute("data-drawn-step")).toBe(
        await renderer.getAttribute("data-step"),
      );
      await scan(page);
      await expect(slider).toBeFocused();
    });
  });
}

/**
 * Tabs through the page and records the focus ring of every control that
 * sits on the glow.
 */
async function focusRings(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    (window as unknown as { __focused: Set<Element> }).__focused = new Set();
  });
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const found = await page.evaluate(walkPage);
    for (const entry of found.nonText) outlines.set(key(entry), entry);
    // Stop once focus comes back around to a control already visited.
    const again = await page.evaluate(() => {
      const seen = (window as unknown as { __focused: Set<Element> }).__focused;
      const el = document.activeElement!;
      if (seen.has(el)) return true;
      seen.add(el);
      return false;
    });
    if (again) break;
  }
}

test("the walk across every state matches the committed fixture", () => {
  const found: Walk = {
    text: [...union.values()].sort((a, b) => key(a).localeCompare(key(b))),
    nonText: [...outlines.values()].sort((a, b) =>
      key(a).localeCompare(key(b)),
    ),
  };
  if (UPDATE) {
    writeFileSync(ATMOSPHERE_FIXTURE, `${JSON.stringify(found, null, 2)}\n`);
    writeFileSync(
      IMAGE_FIXTURE,
      `${JSON.stringify({ elements: [...imageElements].sort() }, null, 2)}\n`,
    );
    return;
  }
  expect(found).toEqual(committed);
});
