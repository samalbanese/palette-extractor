import { test, expect, type Page } from "@playwright/test";
import { ready, stageDone, settled } from "./helpers";
import {
  accessible,
  afterStageChange,
  countFrames,
  host,
  pointsCanvas,
} from "./stage-checks";

test("pointer skip is immediate and a copy click retains its action", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  const elapsed = await page.locator(".source-frame").evaluate((el) => {
    const start = performance.now();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return {
      elapsed: performance.now() - start,
      phase: el.querySelector<HTMLElement>(".stage-host")!.dataset.stagePhase,
    };
  });
  expect(elapsed.phase).toBe("done");
  expect(elapsed.elapsed).toBeLessThan(100);
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  const button = page.locator(".swatch-info button").first();
  const color = await button.innerText();
  await page.evaluate(() =>
    window.addEventListener(
      "pointerdown",
      () =>
        (document.body.dataset.copyPhase =
          document.querySelector<HTMLElement>(
            ".stage-host",
          )!.dataset.stagePhase),
      { once: true, capture: true },
    ),
  );
  // Forced, so waiting for the swatch entrance cannot outlast the intro.
  await button.click({ force: true });
  expect(await page.locator("body").getAttribute("data-copy-phase")).toBe(
    "intro",
  );
  await expect(host(page)).toHaveAttribute("data-stage-phase", "done");
  await expect(button).toContainText("Copied!");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    color.trim(),
  );
});

test("touch skips within 100ms and selects both source views", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/");
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  await page.evaluate(() => {
    window.addEventListener(
      "pointerdown",
      (event) => {
        document.body.dataset.skipPhase =
          document.querySelector<HTMLElement>(
            ".stage-host",
          )!.dataset.stagePhase;
        document.body.dataset.skipTime = String(
          performance.now() - event.timeStamp,
        );
      },
      { once: true },
    );
  });
  const box = await page.locator(".source-frame").boundingBox();
  await page.touchscreen.tap(box!.x + 30, box!.y + 30);
  // Read by a listener added after the stage's own, so it sees the phase the
  // tap left behind, not the one before it.
  await expect(page.locator("body")).toHaveAttribute("data-skip-phase", /./);
  expect(await page.locator("body").getAttribute("data-skip-phase")).toBe(
    "done",
  );
  expect(
    Number(await page.locator("body").getAttribute("data-skip-time")),
  ).toBeLessThan(100);
  const group = page.getByRole("group", { name: "Source view" });
  await group.getByRole("button", { name: "Photo", exact: true }).tap();
  await expect(
    group.getByRole("button", { name: "Photo", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(host(page)).toHaveAttribute("data-stage-loop", "idle");
  await group.getByRole("button", { name: "Color space", exact: true }).tap();
  await expect(
    group.getByRole("button", { name: "Color space", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("reduced motion draws once with stable pixels and no stage animations", async ({
  page,
}) => {
  const frames = await countFrames(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/);
  await expect(host(page)).toHaveAttribute("data-stage-loop", "idle");
  const first = await pointsCanvas(page);
  expect(first.drawn).toBeGreaterThanOrEqual(500);
  const counted = await frames();
  const requested = await host(page).getAttribute("data-stage-raf");
  await page.waitForTimeout(1000);
  expect((await pointsCanvas(page)).image).toBe(first.image);
  expect(await frames()).toBe(counted);
  expect(await host(page).getAttribute("data-stage-raf")).toBe(requested);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => {
          const target = (a.effect as KeyframeEffect)?.target;
          return (
            target instanceof Element &&
            (!!target.closest(".stage-host,.stage-flyers") ||
              (a.effect as KeyframeEffect).pseudoElement === "::after")
          );
        }).length,
    ),
  ).toBe(0);
});

test("a skip before the flight leaves nothing moving once done is reported", async ({
  page,
}) => {
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-started-at", /\d/);
  const step = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage-host")!;
    // Read in the same task the attribute is written, before any frame.
    new MutationObserver(() => {
      if (!stage.dataset.stageDoneAt) return;
      document.body.dataset.pulsesAtDone = String(
        document
          .getAnimations()
          .filter(
            (a) =>
              (a.effect as KeyframeEffect).pseudoElement === "::after" &&
              a.playState === "running",
          ).length,
      );
    }).observe(stage, { attributeFilter: ["data-stage-done-at"] });
    const before = stage.dataset.stageStep;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return before;
  });
  expect(["lift", "settle", "split", "converge"]).toContain(step);
  await expect(page.locator("body")).toHaveAttribute(
    "data-pulses-at-done",
    "0",
  );
  // Nothing starts pulsing after the finish either.
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) => (a.effect as KeyframeEffect).pseudoElement === "::after",
          ).length,
    ),
  ).toBe(0);
});

test("same-photo changes keep the cloud on screen and pulse nothing", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page.evaluate(() => {
    const win = window as unknown as { __pulses: number; __blank: number };
    win.__pulses = 0;
    win.__blank = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (typeof options === "object" && options.pseudoElement === "::after")
        win.__pulses++;
      return animate.call(this, keyframes, options);
    };
    // Whenever a points canvas leaves, what remains must already show points.
    const surface = document.querySelector(".stage-surface")!;
    new MutationObserver((records) => {
      if (!records.some((r) => r.removedNodes.length)) return;
      const shown = [...surface.querySelectorAll("canvas")].some((canvas) => {
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext("2d")!;
        ctx.drawImage(canvas, 0, 0);
        const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
        for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
        return false;
      });
      if (!shown) win.__blank++;
    }).observe(surface, { childList: true });
  });
  const perceptual = page.getByRole("radio", {
    name: "Perceptual",
    exact: true,
  });
  const rgb = page.getByRole("radio", { name: "RGB", exact: true });
  for (let i = 0; i < 4; i++)
    await afterStageChange(page, () => (i % 2 ? rgb : perceptual).check());
  await afterStageChange(page, () =>
    page.getByRole("button", { name: "More colors" }).click(),
  );
  const counts = await page.evaluate(() => {
    const win = window as unknown as { __pulses: number; __blank: number };
    return { pulses: win.__pulses, blank: win.__blank };
  });
  expect(counts).toEqual({ pulses: 0, blank: 0 });
  expect(await page.locator(".stage-points").count()).toBe(1);
});

test("the photo fades under the points from the first stage frame", async ({
  page,
}) => {
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const stage = document.querySelector<HTMLElement>(".stage-host");
      if (!stage?.dataset.stageStartedAt) return;
      observer.disconnect();
      const photo = document.querySelector(".source-frame > img")!;
      document.body.dataset.photoAnimations = String(
        photo.getAnimations().filter((a) => a.playState === "running").length,
      );
    }).observe(document, {
      subtree: true,
      attributeFilter: ["data-stage-started-at"],
    });
  });
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute(
    "data-photo-animations",
    "0",
  );
});

for (const outcome of ["slow", "failed"] as const) {
  test(`the photo stays uncovered while a ${outcome} stage start has drawn nothing`, async ({
    page,
  }) => {
    // The app decodes the photo before it loads the stage; only a decode
    // asked for once the stage has mounted is the stage's own.
    await page.addInitScript((outcome) => {
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        if (
          !document.querySelector(".stage-surface") ||
          !this.matches(".source-frame > img")
        )
          return original.call(this);
        document.body.dataset.stageDecode = outcome;
        return outcome === "slow"
          ? new Promise<void>(() => {})
          : Promise.reject(new DOMException("held", "EncodingError"));
      };
    }, outcome);
    await page.goto("/");
    await expect(page.locator("body")).toHaveAttribute(
      "data-stage-decode",
      outcome,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const view = await page.locator(".source-frame").evaluate(async (frame) => {
      const photo = frame.querySelector(":scope > img")!;
      await Promise.all(photo.getAnimations().map((a) => a.finished));
      const style = getComputedStyle(frame.querySelector(".stage-surface")!);
      return {
        step: frame.querySelector<HTMLElement>(".stage-host")!.dataset
          .stageStep,
        covered:
          style.opacity !== "0" && style.backgroundColor !== "rgba(0, 0, 0, 0)",
        photo: getComputedStyle(photo).opacity,
      };
    });
    expect(view).toEqual({ step: undefined, covered: false, photo: "1" });
  });
}

test("an intro hidden while it starts resumes when the tab returns", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const win = window as unknown as { __hidden: boolean };
    win.__hidden = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => win.__hidden,
    });
  });
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  await expect(host(page)).toHaveAttribute("data-stage-loop", "idle");
  await page.evaluate(() => {
    (window as unknown as { __hidden: boolean }).__hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/, {
    timeout: 8000,
  });
});

test("changing motion preference during the intro finishes it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(host(page)).toHaveAttribute("data-stage-phase", "done");
  await expect(host(page)).toHaveAttribute("data-stage-loop", "idle");
});

test("a new sample uses the short intro and preserves its palette", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
  const start = await page.evaluate(() => performance.now());
  await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/, {
    timeout: 2500,
  });
  const duration =
    Number(await host(page).getAttribute("data-stage-done-at")) - start;
  expect(duration).toBeLessThan(2000);
  expect(duration).toBeGreaterThan(900);
  expect(
    await page
      .locator(".swatch-select")
      .evaluateAll((els) =>
        els.map(
          (el) => el.getAttribute("aria-label")!.match(/#[0-9a-f]{6}/i)![0],
        ),
      ),
  ).toEqual(["#17251e", "#233531", "#29403a", "#30514a", "#337265", "#2c3731"]);
  await page.getByRole("radio", { name: "Perceptual", exact: true }).check();
  await ready(page);
  await expect(page.locator(".stage-points")).toHaveAttribute(
    "aria-label",
    /Forest floor.*Perceptual space/,
  );
  await expect(host(page)).toHaveAttribute("data-stage-phase", "done");
});

test("a delayed sample cannot replace the last committed stage", async ({
  page,
}) => {
  let held = 0;
  await page.route("**/samples/fern.webp", async (route) => {
    held++;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.goto("/");
  await stageDone(page);
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await page.getByRole("button", { name: "Try Coastal color" }).click();
  await expect(page.locator(".stage-points")).toHaveAttribute(
    "aria-label",
    /Coastal color/,
  );
  await page.waitForTimeout(3500);
  expect(held).toBeGreaterThan(0);
  await expect(page.locator(".stage-points")).toHaveAttribute(
    "aria-label",
    /Coastal color/,
  );
});

test("source switch supports mouse, Tab, Enter and Space with visible focus", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  const photo = page.getByRole("button", { name: "Photo", exact: true }),
    cloud = page.getByRole("button", { name: "Color space", exact: true });
  await photo.click();
  await expect(photo).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await expect(cloud).toBeFocused();
  expect(
    await cloud.evaluate(
      (el) =>
        getComputedStyle(el).outlineStyle !== "none" ||
        getComputedStyle(el).boxShadow !== "none",
    ),
  ).toBe(true);
  await page.keyboard.press("Enter");
  await expect(cloud).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+Tab");
  await expect(photo).toBeFocused();
  await page.keyboard.press("Space");
  await expect(photo).toHaveAttribute("aria-pressed", "true");
});

// Intro checkpoints: the page clock steps the stage to a known phase, then
// the frame loop is starved and every CSS and WAAPI animation paused, so axe
// (which needs running timers) scans one still frame.
async function freezeAt(page: Page, phase: string) {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto("/");
  await expect
    .poll(
      async () => {
        await page.clock.runFor(16);
        return host(page).getAttribute("data-stage-step");
      },
      { timeout: 20000, intervals: [0] },
    )
    .toBe(phase);
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  // The frame already queued draws once more, then the loop ends.
  await page.clock.runFor(16);
  await page.clock.resume();
  // An animation started in that last frame is still pending, and a pending
  // pause only fixes its time on the next frame, so wait for each to settle.
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((a) => {
        a.pause();
        return a.ready;
      }),
    ),
  );
  await expect(host(page)).toHaveAttribute("data-stage-step", phase);
}
const still = (page: Page) =>
  page.evaluate(() => ({
    points: document
      .querySelector<HTMLCanvasElement>(".stage-points")!
      .toDataURL(),
    times: document
      .getAnimations()
      .map((a) => String(a.currentTime))
      .join(),
    wire: document.querySelector<HTMLCanvasElement>(".stage-wire")!.toDataURL(),
    // Each swatch's effective opacity, including every ancestor's.
    opacities: [...document.querySelectorAll(".swatch-color")].map((el) => {
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity);
      return String(opacity);
    }),
  }));

for (const width of [390, 768, 1440]) {
  for (const phase of ["lift", "split", "flight"] as const)
    test(`intro at ${phase} is accessible at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await freezeAt(page, phase);
      const before = await still(page);
      expect(new Set(before.opacities)).toEqual(new Set(["1"]));
      await accessible(page);
      expect(await still(page)).toEqual(before);
      await expect(host(page)).toHaveAttribute("data-stage-phase", "intro");
    });
  for (const state of ["cloud", "photo", "reduced"] as const)
    test(`${state} is accessible at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (state === "reduced")
        await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await settled(page);
      if (state === "photo")
        await page.getByRole("button", { name: "Photo", exact: true }).click();
      await accessible(page);
    });
}
