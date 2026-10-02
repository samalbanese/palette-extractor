import { expect, type Page } from "@playwright/test";
import { contrastRatio } from "../src/lib/contrast";
import type { RGB } from "../src/lib/color";

type Gate = { held: Map<number, FrameRequestCallback> | null; next: number };
type Stamped = Animation & { clockStart?: number };

export const grid = (page: Page) => page.locator(".swatch-grid");

export const hexToRgb = (hex: string): RGB => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

/**
 * Installs the page clock and stamps each WAAPI animation with the clock time
 * it was created at, then opens the page and waits for the palette to rest.
 * Must run before the page loads.
 */
export async function openOnClock(page: Page, path: string) {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      ...args: Parameters<Element["animate"]>
    ) {
      const animation: Stamped = animate.apply(this, args);
      animation.clockStart = performance.now();
      return animation;
    };
  });
  await page.clock.install({ time: 0 });
  await page.goto(path);
  await expect(page.locator("#workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".swatch").first()).toBeVisible();
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
  // Swatch entrances run on the real document timeline; let them finish.
  await page.waitForFunction(() =>
    document
      .querySelector(".swatch-grid")!
      .getAnimations({ subtree: true })
      .every((a) => a.playState !== "running"),
  );
  await countCommits(page);
}

/** Stops the clock a little ahead of now, with nothing left due. */
export async function pauseClock(page: Page) {
  await page.clock.pauseAt(
    (await page.evaluate(() => Math.ceil(Date.now()))) + 1000,
  );
}

async function countCommits(page: Page) {
  await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(".swatch-grid")!;
    const w = window as unknown as { __morphCommits: number };
    w.__morphCommits = 0;
    // Counted per write, so two commits at the same clock time still count.
    new MutationObserver(() => w.__morphCommits++).observe(node, {
      attributeFilter: ["data-morph-started-at"],
    });
  });
}

/**
 * Makes a palette change and waits until the grid commits it. Returns the
 * morph's start on the page clock.
 */
export async function commit(page: Page, change: () => Promise<unknown>) {
  const count = () =>
    page.evaluate(
      () => (window as unknown as { __morphCommits: number }).__morphCommits,
    );
  const before = await count();
  await change();
  await expect.poll(count).toBeGreaterThan(before);
  return Number(await grid(page).getAttribute("data-morph-started-at"));
}

export const setHash = (page: Page, hash: string) =>
  page.evaluate((value) => {
    location.hash = value;
  }, hash);

/** Changes the sort without moving focus off whatever holds it. */
export const setSort = (page: Page, value: string) =>
  page.evaluate((value) => {
    const select = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Sort palette"]',
    )!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);

/** Runs the paused clock forward to `time` (page clock milliseconds). */
export async function runTo(page: Page, time: number) {
  const now = await page.evaluate(() => performance.now());
  if (time > now) await page.clock.runFor(time - now);
}

/**
 * Reversible frame gate: while closed, animation frame requests are held
 * instead of scheduled; opening it runs each held callback once, then frames
 * flow normally again. Cancelling a held frame drops it.
 */
export async function holdFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frameGate?: Gate };
    if (!w.__frameGate) {
      const gate: Gate = { held: null, next: -1 };
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        if (!gate.held) return request(callback);
        gate.held.set(gate.next, callback);
        return gate.next--;
      };
      window.cancelAnimationFrame = (handle) => {
        if (handle < 0) gate.held?.delete(handle);
        else cancel(handle);
      };
      w.__frameGate = gate;
    }
    w.__frameGate.held ??= new Map();
  });
}

export async function releaseFrames(page: Page) {
  await page.evaluate(() => {
    const gate = (window as unknown as { __frameGate: Gate }).__frameGate;
    const held = [...(gate.held?.values() ?? [])];
    gate.held = null;
    const now = performance.now();
    held.forEach((callback) => callback(now));
  });
}

/**
 * Destructive freeze for pages that will not continue: frames stop for good
 * once the one already queued has run.
 */
export async function stopFrames(page: Page) {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.clock.runFor(16);
}

/**
 * Pauses every morph and atmosphere animation at its own elapsed time on the
 * page clock (now minus the clock time it started at), never one shared value.
 * Any other animation (an ambient pulse, say) holds where it is, so a frozen
 * frame really is still.
 */
export async function pinAnimations(page: Page) {
  await page.evaluate(async () => {
    const now = performance.now();
    const all = document.getAnimations() as Stamped[];
    await Promise.all(
      all.map((a) => {
        a.pause();
        return a.ready;
      }),
    );
    for (const a of all)
      if (/^(morph|atmosphere)-/.test(a.id))
        a.currentTime = now - a.clockStart!;
  });
}

/** Everything a frozen frame must hold still. */
export async function frame(page: Page) {
  return page.evaluate(() => {
    const swatches = [...document.querySelectorAll<HTMLElement>(".swatch")];
    return {
      ids: swatches.map((el) => el.dataset.swatchId!),
      swatch: swatches.map((el) =>
        getComputedStyle(el).getPropertyValue("--swatch").trim(),
      ),
      label: swatches.map((el) =>
        getComputedStyle(el).getPropertyValue("--label").trim(),
      ),
      rects: swatches.map((el) => {
        const { left, top, width, height } = el
          .querySelector(".swatch-motion")!
          .getBoundingClientRect();
        return { left, top, width, height };
      }),
      times: document.getAnimations().map((a) => String(a.currentTime)),
      hexes: swatches.map(
        (el) =>
          el
            .querySelector(".swatch-select")!
            .getAttribute("aria-label")!
            .match(/#[0-9a-f]{6}/)![0],
      ),
    };
  });
}

/** Runs `read` on a frozen frame, failing if anything moved while it ran. */
export async function frozen<T>(page: Page, read: () => Promise<T>) {
  const before = await frame(page);
  const result = await read();
  expect(await frame(page)).toEqual(before);
  return result;
}

/**
 * Contrast of each swatch label's ink, after its own opacity, against the
 * color the swatch is showing.
 */
export async function labelContrast(page: Page) {
  const inks = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".swatch")].map((swatch) => {
      const label = swatch.querySelector<HTMLElement>(
        ".swatch-select span:first-child",
      )!;
      let alpha = 1;
      for (
        let node: HTMLElement | null = label;
        node && node !== swatch;
        node = node.parentElement
      )
        alpha *= Number(getComputedStyle(node).opacity);
      return {
        background: getComputedStyle(swatch)
          .getPropertyValue("--swatch")
          .trim(),
        ink: getComputedStyle(label).color,
        alpha,
      };
    }),
  );
  return inks.map(({ background, ink, alpha }) => {
    const [r, g, b] = ink.match(/\d+/g)!.map(Number);
    const bg = hexToRgb(background);
    const mix = (a: number, b: number) =>
      Math.round(a * alpha + b * (1 - alpha));
    return contrastRatio(
      { r: mix(r, bg.r), g: mix(g, bg.g), b: mix(b, bg.b) },
      bg,
    );
  });
}
