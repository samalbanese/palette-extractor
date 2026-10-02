import { test, expect, type Page } from "@playwright/test";
import { settled, stageDone } from "./helpers";
import { accessible, host } from "./stage-checks";

/**
 * Watches every swatch from before the page loads. Each frame records, per
 * swatch, whether it shows as an empty slot, fully filled, or in between,
 * and the first time each one was filled. Chips are timed as they land
 * (leave the page), and any slot that ever appears is noted.
 */
async function watchSwatches(page: Page) {
  await page.addInitScript(() => {
    type Watch = {
      firstPaint: string[] | null;
      at1500: string[] | null;
      filledAt: Record<number, number>;
      landedAt: Record<number, number>;
      allFilledAt: number | null;
      slotSeen: boolean;
      states: () => string[];
    };
    const LABELS =
      ".swatch-select > span, .lock-button, .swatch-info > span, .swatch-info code";
    const opacityWithin = (el: Element, root: Element) => {
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity);
        if (node === root) break;
      }
      return opacity;
    };
    const state = (swatch: Element) => {
      const color = swatch.querySelector(".swatch-color")!;
      const background = getComputedStyle(color).backgroundColor;
      const painted = !/^rgba\(.*,\s*0\)$|^transparent$/.test(background);
      const opacities = [...swatch.querySelectorAll(LABELS)].map((label) =>
        opacityWithin(label, swatch),
      );
      if (!painted && opacities.every((o) => o === 0)) return "slot";
      if (
        painted &&
        !swatch.hasAttribute("data-slot") &&
        opacities.every((o) => o >= 0.8)
      )
        return "filled";
      return "partial";
    };
    const w = window as unknown as { __watch: Watch };
    const watch: Watch = {
      firstPaint: null,
      at1500: null,
      filledAt: {},
      landedAt: {},
      allFilledAt: null,
      slotSeen: false,
      states: () => [...document.querySelectorAll(".swatch")].map(state),
    };
    w.__watch = watch;
    new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === "attributes" &&
          (record.target as Element).hasAttribute("data-slot")
        )
          watch.slotSeen = true;
        for (const node of record.removedNodes)
          if (node instanceof HTMLElement && node.matches(".stage-flyer"))
            watch.landedAt[Number(node.dataset.swatchIndex)] ??=
              performance.now();
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributeFilter: ["data-slot"],
    });
    const frame = () => {
      const swatches = [...document.querySelectorAll(".swatch")];
      if (swatches.length) {
        const states = swatches.map(state);
        const now = performance.now();
        watch.firstPaint ??= states;
        if (now >= 1500) watch.at1500 ??= states;
        states.forEach((s, i) => {
          if (s === "filled") watch.filledAt[i] ??= now;
        });
        if (states.every((s) => s === "filled")) watch.allFilledAt ??= now;
        else watch.allFilledAt = null;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  return () =>
    page.evaluate(() => {
      const watch = (
        window as unknown as {
          __watch: {
            firstPaint: string[] | null;
            at1500: string[] | null;
            filledAt: Record<number, number>;
            landedAt: Record<number, number>;
            allFilledAt: number | null;
            slotSeen: boolean;
            states: () => string[];
          };
        }
      ).__watch;
      return {
        firstPaint: watch.firstPaint,
        at1500: watch.at1500,
        filledAt: watch.filledAt,
        landedAt: watch.landedAt,
        allFilledAt: watch.allFilledAt,
        slotSeen: watch.slotSeen,
        now: watch.states(),
      };
    });
}

/** Waits until the watcher has seen a frame with every swatch filled. */
const allFilled = async (read: Awaited<ReturnType<typeof watchSwatches>>) =>
  expect
    .poll(
      async () => {
        const seen = await read();
        return (
          seen.allFilledAt !== null && seen.now.every((s) => s === "filled")
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`the first palette waits as slots and each swatch fills as its chip lands at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const read = await watchSwatches(page);
    await page.goto("/");
    await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/, {
      timeout: 15000,
    });
    await allFilled(read);
    const seen = await read();
    expect(seen.firstPaint).toEqual(Array(6).fill("slot"));
    expect(seen.at1500).toEqual(Array(6).fill("slot"));
    const landed = Object.entries(seen.landedAt);
    expect(landed.length).toBeGreaterThan(0);
    for (const [index, at] of landed) {
      const filled = seen.filledAt[Number(index)];
      // Filled with its chip, never before it arrives.
      expect(filled - at, `swatch ${index}`).toBeLessThanOrEqual(150);
      expect(filled - at, `swatch ${index}`).toBeGreaterThanOrEqual(-20);
    }
    const endsAt = Number(await host(page).getAttribute("data-stage-ends-at"));
    expect(seen.allFilledAt!).toBeLessThanOrEqual(endsAt + 600);
  });

test("a pointerdown at 1 s fills every slot at once", async ({ page }) => {
  const read = await watchSwatches(page);
  await page.goto("/");
  await expect(page.locator(".swatch[data-slot]")).toHaveCount(6);
  const result = await page.evaluate(async () => {
    while (performance.now() < 1000)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const start = performance.now();
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    const watch = (window as unknown as { __watch: { states: () => string[] } })
      .__watch;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      start,
      states: watch.states(),
      elapsed: performance.now() - start,
    };
  });
  expect(result.start).toBeLessThan(1400);
  expect(result.states).toEqual(Array(6).fill("filled"));
  expect(result.elapsed).toBeLessThanOrEqual(1000 / 60 + 50);
  await stageDone(page);
  expect((await read()).now).toEqual(Array(6).fill("filled"));
});

test("reduced motion paints filled swatches from the first frame", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const read = await watchSwatches(page);
  await page.goto("/");
  await stageDone(page);
  const seen = await read();
  expect(seen.firstPaint).toEqual(Array(6).fill("filled"));
  expect(seen.slotSeen).toBe(false);
});

test("a blocked stage download still fills every swatch in time", async ({
  page,
}) => {
  await page.route(/\/components\/Stage\.tsx/, (route) => route.abort());
  const read = await watchSwatches(page);
  await page.goto("/");
  await allFilled(read);
  expect((await read()).allFilledAt!).toBeLessThanOrEqual(3400);
  await expect(host(page)).toHaveAttribute("data-stage-mode", "pending");
});

test("a stage start that never finishes still fills every swatch in time", async ({
  page,
}) => {
  // The stage decodes the photo again before it draws; hold that forever.
  await page.addInitScript(() => {
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
      if (document.querySelector(".stage-surface"))
        return new Promise<void>(() => {});
      return original.call(this);
    };
  });
  const read = await watchSwatches(page);
  await page.goto("/");
  await expect(page.locator(".stage-surface")).toHaveCount(1);
  await allFilled(read);
  expect((await read()).allFilledAt!).toBeLessThanOrEqual(3400 + 50);
});

test("a photo that cannot be decoded for the stage fills every swatch", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
      if (document.querySelector(".stage-surface"))
        return Promise.reject(new DOMException("broken", "EncodingError"));
      return original.call(this);
    };
  });
  const read = await watchSwatches(page);
  await page.goto("/");
  await expect(page.locator(".stage-surface")).toHaveCount(1);
  await allFilled(read);
  const seen = await read();
  expect(seen.allFilledAt!).toBeLessThanOrEqual(3400);
});

test("an intro in a hidden tab still fills by its planned end", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
  });
  const read = await watchSwatches(page);
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-ends-at", /\d/);
  await allFilled(read);
  const endsAt = Number(await host(page).getAttribute("data-stage-ends-at"));
  // The deadline timer, plus a frame of slack for the watcher.
  expect((await read()).allFilledAt!).toBeLessThanOrEqual(endsAt + 600 + 50);
});

test("choosing Photo mid-intro fills every swatch", async ({ page }) => {
  const read = await watchSwatches(page);
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  // A click with no pointer, so only the view change itself can fill.
  await page
    .getByRole("button", { name: "Photo", exact: true })
    .evaluate((button: HTMLElement) => button.click());
  expect((await read()).now).toEqual(Array(6).fill("filled"));
});

test("a new photo waits as slots on the short intro; same-photo changes never do", async ({
  page,
}) => {
  const read = await watchSwatches(page);
  await page.goto("/");
  await stageDone(page);
  await allFilled(read);
  // Count and sort changes keep every swatch filled.
  await page.evaluate(() => {
    (window as unknown as { __watch: { slotSeen: boolean } }).__watch.slotSeen =
      false;
  });
  await page.getByRole("button", { name: "More colors", exact: true }).click();
  await expect(page.locator(".swatch")).toHaveCount(7);
  await page.getByLabel("Sort palette", { exact: true }).selectOption("hue");
  await page
    .getByRole("radio", { name: "Perceptual", exact: true })
    .check({ force: true });
  await expect(page.locator(".swatch-grid")).toHaveAttribute(
    "data-morph",
    "idle",
  );
  await stageDone(page);
  expect((await read()).slotSeen).toBe(false);
  expect((await read()).now.every((s) => s === "filled")).toBe(true);

  // A new photo does, and its short intro fills them all on time.
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await expect.poll(async () => (await read()).slotSeen).toBe(true);
  await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/);
  await allFilled(read);
  const endsAt = Number(await host(page).getAttribute("data-stage-ends-at"));
  const started = Number(
    await host(page).getAttribute("data-stage-started-at"),
  );
  expect(endsAt - started).toBeLessThan(2000);
  expect((await read()).allFilledAt!).toBeLessThanOrEqual(endsAt + 600);
});

test("with the Photo view chosen, a new photo never shows slots", async ({
  page,
}) => {
  const read = await watchSwatches(page);
  await page.goto("/");
  await stageDone(page);
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { __watch: { slotSeen: boolean } }).__watch.slotSeen =
      false;
  });
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await expect(page.locator(".image-caption")).toContainText("Forest floor");
  await stageDone(page);
  expect((await read()).slotSeen).toBe(false);
});

test("slots are accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".swatch[data-slot]")).toHaveCount(6);
  await page.evaluate(() =>
    document.getAnimations().forEach((animation) => animation.pause()),
  );
  await accessible(page);
});

/**
 * Samples every frame of a reorder and reports each time a swatch's visible
 * label (opacity above 0.1) overlaps another swatch's color block or labels.
 */
async function labelCollisions(page: Page, change: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __hits: string[]; __frames: number };
    w.__hits = [];
    w.__frames = 0;
    const LABELS =
      ".swatch-select > span, .swatch-info > span, .swatch-info code";
    const visible = (el: Element) => {
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity);
      return opacity > 0.1;
    };
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const tick = () => {
      const grid = document.querySelector<HTMLElement>(".swatch-grid")!;
      if (grid.dataset.morph !== "running") return;
      w.__frames++;
      const swatches = [...document.querySelectorAll(".swatch")].map(
        (swatch) => ({
          id: (swatch as HTMLElement).dataset.swatchId,
          block: swatch.querySelector(".swatch-color")!.getBoundingClientRect(),
          labels: [...swatch.querySelectorAll(LABELS)]
            .filter((label) => label.textContent!.trim())
            .map((label) => ({
              text: label.textContent!.trim(),
              box: label.getBoundingClientRect(),
              shown: visible(label),
            })),
        }),
      );
      for (const a of swatches)
        for (const label of a.labels) {
          if (!label.shown) continue;
          for (const b of swatches) {
            if (a === b) continue;
            if (overlap(label.box, b.block))
              w.__hits.push(`${label.text} over ${b.id}'s color`);
            for (const other of b.labels)
              if (other.shown && overlap(label.box, other.box))
                w.__hits.push(`${label.text} over ${other.text}`);
          }
        }
      requestAnimationFrame(tick);
    };
    new MutationObserver(() => requestAnimationFrame(tick)).observe(
      document.querySelector(".swatch-grid")!,
      { attributeFilter: ["data-morph-started-at"] },
    );
  });
  await change();
  await expect(page.locator(".swatch-grid")).toHaveAttribute(
    "data-morph",
    "running",
  );
  await expect(page.locator(".swatch-grid")).toHaveAttribute(
    "data-morph",
    "idle",
  );
  return page.evaluate(() => {
    const w = window as unknown as { __hits: string[]; __frames: number };
    return { hits: [...new Set(w.__hits)], frames: w.__frames };
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`mid-reorder labels never print over another swatch at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await settled(page);
    for (const sort of ["hue", "luminance", "original"]) {
      const { hits, frames } = await labelCollisions(page, () =>
        page
          .getByLabel("Sort palette", { exact: true })
          .selectOption(sort)
          .then(() => undefined),
      );
      expect(frames, sort).toBeGreaterThan(5);
      expect(hits, sort).toEqual([]);
    }
  });
