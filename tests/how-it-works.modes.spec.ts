import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ready, svg } from "./helpers";

// Box edges, color positions and final markers for a ten-band test image,
// recorded once from the cube projection, fitted to the image's samples, and
// the quantizer's split data at the renderer size and still angle below.
const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/trace-geometry.json", import.meta.url), {
    encoding: "utf8",
  }),
) as Fixture;

type Edge = [number, number, number, number];
interface Trace {
  palette: string[];
  steps: { edges: Edge[] }[];
  points: { hex: string; x: number; y: number }[];
  markers: { hex: string; x: number; y: number; radius: number }[];
}
interface Fixture {
  image: { width: number; height: number; bands: [string, number][] };
  renderer: { width: number; height: number; angle: number };
  traces: Record<"rgb-6" | "oklab-6" | "rgb-8", Trace>;
}
interface Layer {
  width: number;
  height: number;
  data: Buffer;
}
interface Layers {
  points: Layer;
  overlay: Layer;
}

const bandsImage = () => {
  let y = 0;
  const rects = FIXTURE.image.bands.map(([fill, rows]) => {
    const rect = `<rect y="${y}" width="${FIXTURE.image.width}" height="${rows}" fill="${fill}"/>`;
    y += rows;
    return rect;
  });
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${FIXTURE.image.width}" height="${FIXTURE.image.height}" shape-rendering="crispEdges">${rects.join("")}</svg>`,
  );
};

const renderer = (page: Page) => page.locator(".algorithm-renderer");
const slider = (page: Page) => page.getByRole("slider", { name: "Split step" });

function expectedMode(testInfo: TestInfo) {
  return testInfo.project.name === "modes-no-webgl" ? "2d" : "webgl";
}

async function swatchHexes(page: Page): Promise<string[]> {
  return page
    .locator(".swatch-select")
    .evaluateAll((els) =>
      els.map(
        (el) => el.getAttribute("aria-label")!.match(/#[0-9a-f]{6}/i)![0],
      ),
    );
}

async function uploadBands(page: Page) {
  await page.locator("input[type=file]").setInputFiles({
    name: "bands.svg",
    mimeType: "image/svg+xml",
    buffer: bandsImage(),
  });
  await expect(page.locator(".image-caption")).toContainText("bands.svg");
  await ready(page);
}

/** Opens How it works with its renderer pinned to the recorded size. */
async function openPanel(page: Page, testInfo: TestInfo) {
  await page.addStyleTag({
    content: `.algorithm-renderer { width: ${FIXTURE.renderer.width}px !important; height: ${FIXTURE.renderer.height}px !important; }`,
  });
  await page.getByRole("tab", { name: "How it works" }).click();
  await page.locator(".algorithm-canvas").scrollIntoViewIfNeeded();
  await expect(renderer(page)).toHaveAttribute(
    "data-trace-mode",
    expectedMode(testInfo),
  );
}

/** Waits until the frame for this step is on screen. */
async function drawnStep(page: Page, step: number, steps?: number) {
  if (steps !== undefined)
    await expect(page.locator(".cube-bottomline")).toContainText(
      `/ ${steps} steps`,
    );
  await expect(renderer(page)).toHaveAttribute("data-step", String(step));
  await expect(renderer(page)).toHaveAttribute("data-drawn-step", String(step));
}

/** Moves the scrubber with the keyboard: Home, then right arrows. */
async function scrubTo(page: Page, step: number) {
  await slider(page).focus();
  await slider(page).press("Home");
  for (let i = 0; i < step; i++) await slider(page).press("ArrowRight");
}

// Canvas pixels travel as base64 so a whole layer crosses in one call.
const READ_LAYER = `(canvas) => {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  const data = copy.getContext("2d").getImageData(0, 0, copy.width, copy.height).data;
  let text = "";
  for (let i = 0; i < data.length; i += 0x8000)
    text += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return { width: copy.width, height: copy.height, data: btoa(text) };
}`;

const decode = (layer: { width: number; height: number; data: string }) => ({
  ...layer,
  data: Buffer.from(layer.data, "base64"),
});

/** The drawing layers as they are on screen now. */
async function readLayers(page: Page): Promise<Layers> {
  const raw = await page.evaluate((source) => {
    const read = new Function(`return ${source}`)() as (
      c: HTMLCanvasElement,
    ) => unknown;
    return {
      points: read(document.querySelector(".trace-points")!),
      overlay: read(document.querySelector(".trace-overlay")!),
    };
  }, READ_LAYER);
  const { points, overlay } = raw as Record<
    keyof Layers,
    { width: number; height: number; data: string }
  >;
  return { points: decode(points), overlay: decode(overlay) };
}

/** Keeps a copy of both layers each time a different step is drawn. */
async function recordFrames(page: Page) {
  await page.evaluate(() => {
    const frames: { step: number; layers: HTMLCanvasElement[] }[] = [];
    (window as unknown as { traceFrames: typeof frames }).traceFrames = frames;
    const copy = (canvas: HTMLCanvasElement) => {
      const next = document.createElement("canvas");
      next.width = canvas.width;
      next.height = canvas.height;
      next.getContext("2d")!.drawImage(canvas, 0, 0);
      return next;
    };
    new MutationObserver((records) => {
      for (const record of records) {
        const host = record.target as HTMLElement;
        const step = host.dataset.drawnStep;
        if (step === undefined || step === record.oldValue) continue;
        frames.push({
          step: Number(step),
          layers: [".trace-points", ".trace-overlay"].map((selector) =>
            copy(host.querySelector<HTMLCanvasElement>(selector)!),
          ),
        });
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-drawn-step"],
      attributeOldValue: true,
    });
  });
}

const recordedSteps = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { traceFrames: { step: number }[] }).traceFrames.map(
      (frame) => frame.step,
    ),
  );

async function recordedFrame(page: Page, index: number): Promise<Layers> {
  const raw = await page.evaluate(
    ({ source, index }) => {
      const read = new Function(`return ${source}`)() as (
        c: HTMLCanvasElement,
      ) => unknown;
      const frame = (
        window as unknown as {
          traceFrames: { layers: HTMLCanvasElement[] }[];
        }
      ).traceFrames[index];
      return frame.layers.map(read);
    },
    { source: READ_LAYER, index },
  );
  const [points, overlay] = raw as {
    width: number;
    height: number;
    data: string;
  }[];
  return { points: decode(points), overlay: decode(overlay) };
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function pixel(layer: Layer, x: number, y: number) {
  if (x < 0 || y < 0 || x >= layer.width || y >= layer.height)
    return [0, 0, 0, 0];
  const i = (y * layer.width + x) * 4;
  return [...layer.data.subarray(i, i + 4)];
}

/** Whether any pixel within `r` of the point has paint on it. */
function inked(layer: Layer, x: number, y: number, r = 1) {
  const cx = Math.floor(x),
    cy = Math.floor(y);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (pixel(layer, cx + dx, cy + dy)[3] > 0) return true;
  return false;
}

const length = ([x1, y1, x2, y2]: Edge) => Math.hypot(x2 - x1, y2 - y1);
const along = ([x1, y1, x2, y2]: Edge, t: number) =>
  [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t] as const;
const sameEdge = (a: Edge, b: Edge) =>
  [
    [0, 1, 2, 3],
    [2, 3, 0, 1],
  ].some((order) => order.every((k, i) => Math.abs(a[i] - b[k]) < 0.5));
function distanceToEdge(x: number, y: number, [x1, y1, x2, y2]: Edge) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const t =
    dx || dy
      ? Math.max(
          0,
          Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
        )
      : 0;
  return Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
}

/**
 * The overlay shows exactly the boxes of `stepIndex`: ink along every one of
 * its edges and none along edges that belong only to other steps. At the
 * final step every palette color appears in its marker. The points layer
 * has every color at its recorded position and paint nowhere else.
 */
function expectStep(
  layers: Layers,
  trace: Trace,
  stepIndex: number,
  { present = trace.points.map((p) => p.hex) } = {},
) {
  const { overlay, points } = layers;
  expect(overlay.width).toBe(FIXTURE.renderer.width);
  expect(overlay.height).toBe(FIXTURE.renderer.height);
  const current = trace.steps[stepIndex].edges;
  const final = stepIndex === trace.steps.length - 1;

  const missing = current
    .filter((edge) => length(edge) >= 8)
    .flatMap((edge) =>
      [0.25, 0.5, 0.75]
        .map((t) => along(edge, t))
        .filter(([x, y]) => !inked(overlay, x, y)),
    );
  expect(missing, `step ${stepIndex}: edges with no ink`).toEqual([]);

  const others = trace.steps
    .flatMap((step, j) => (j === stepIndex ? [] : step.edges))
    .filter(
      (edge) =>
        length(edge) >= 8 && !current.some((mine) => sameEdge(mine, edge)),
    );
  const clear = (x: number, y: number) =>
    current.every((edge) => distanceToEdge(x, y, edge) >= 4) &&
    (!final ||
      trace.markers.every((m) => Math.hypot(x - m.x, y - m.y) >= m.radius + 4));
  let checked = 0;
  const stray: number[][] = [];
  for (const edge of others)
    for (let t = 0.05; t < 1; t += 0.05) {
      const [x, y] = along(edge, t);
      if (!clear(x, y)) continue;
      checked++;
      if (inked(overlay, x, y)) stray.push([Math.round(x), Math.round(y)]);
    }
  expect(stray, `step ${stepIndex}: ink on other steps' edges`).toEqual([]);
  if (others.length) expect(checked).toBeGreaterThan(20);

  if (final) {
    for (const hex of trace.palette) {
      const target = channels(hex);
      let found = false;
      for (let i = 0; i < overlay.data.length && !found; i += 4)
        found =
          overlay.data[i + 3] === 255 &&
          target.every((v, k) => Math.abs(overlay.data[i + k] - v) <= 2);
      expect(found, `marker in ${hex}`).toBe(true);
    }
    trace.markers.forEach((m, i) => {
      // A later marker drawn over this one's center hides it.
      if (
        trace.markers
          .slice(i + 1)
          .some((n) => Math.hypot(n.x - m.x, n.y - m.y) < n.radius + 1)
      )
        return;
      const [r, g, b, a] = pixel(overlay, Math.floor(m.x), Math.floor(m.y));
      expect(a, `marker ${m.hex} opacity`).toBe(255);
      expect(
        [r, g, b].every((v, k) => Math.abs(v - channels(m.hex)[k]) <= 2),
        `marker ${m.hex} at its recorded position`,
      ).toBe(true);
    });
  } else {
    // No markers before the final step: only the translucent box lines.
    let opaque = 0;
    for (let i = 3; i < overlay.data.length; i += 4)
      if (overlay.data[i] === 255) opaque++;
    expect(opaque, `step ${stepIndex}: opaque overlay pixels`).toBe(0);
  }

  for (const p of trace.points.filter((p) => present.includes(p.hex))) {
    const target = channels(p.hex);
    let found = false;
    for (let dy = -2; dy <= 2 && !found; dy++)
      for (let dx = -2; dx <= 2 && !found; dx++) {
        const [r, g, b, a] = pixel(
          points,
          Math.floor(p.x) + dx,
          Math.floor(p.y) + dy,
        );
        found =
          a > 100 && [r, g, b].every((v, k) => Math.abs(v - target[k]) <= 12);
      }
    expect(found, `points in ${p.hex} at their recorded position`).toBe(true);
  }
  const at = trace.points.filter((p) => present.includes(p.hex));
  let elsewhere = 0;
  for (let y = 0; y < points.height; y++)
    for (let x = 0; x < points.width; x++)
      if (
        points.data[(y * points.width + x) * 4 + 3] > 0 &&
        at.every((p) => Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > 3.5)
      )
        elsewhere++;
  expect(elsewhere, "points painted away from every recorded position").toBe(0);
}

const painted = (layer: Layer) => {
  let count = 0;
  for (let i = 3; i < layer.data.length; i += 4) if (layer.data[i] > 0) count++;
  return count;
};

test.describe("geometry, with reduced motion for a still angle", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const space of ["rgb", "oklab"] as const)
    test(`scrubbing draws each split step's boxes in ${space === "rgb" ? "RGB" : "Perceptual"}`, async ({
      page,
    }, testInfo) => {
      const trace = FIXTURE.traces[`${space}-6`];
      await page.goto("/");
      await ready(page);
      await uploadBands(page);
      if (space === "oklab") {
        await page
          .getByRole("radio", { name: "Perceptual", exact: true })
          .check();
        await ready(page);
      }
      // The recorded geometry only applies if the app split the same pixels.
      await expect.poll(() => swatchHexes(page)).toEqual(trace.palette);
      await openPanel(page, testInfo);
      const last = trace.steps.length - 1;
      // Untouched, a still view shows the finished split.
      await drawnStep(page, last, trace.steps.length);
      expectStep(await readLayers(page), trace, last);

      let previous: Buffer | null = null;
      for (let step = 0; step <= last; step++) {
        await scrubTo(page, step);
        await drawnStep(page, step);
        await expect(slider(page)).toHaveAttribute(
          "aria-valuetext",
          `Step ${step + 1} of ${trace.steps.length}: ${step + 1} ${step ? "boxes" : "box"}`,
        );
        const layers = await readLayers(page);
        expectStep(layers, trace, step);
        // Supplementary: something is drawn, and each step looks different.
        expect(painted(layers.overlay)).toBeGreaterThan(100);
        expect(painted(layers.points)).toBeGreaterThan(30);
        if (previous) expect(layers.overlay.data.equals(previous)).toBe(false);
        previous = layers.overlay.data;
      }
      // Step 0 is the unsplit cube: one box, twelve edges.
      expect(trace.steps[0].edges).toHaveLength(12);
    });

  test("the point count is every unlocked sample the renderer can draw", async ({
    page,
  }, testInfo) => {
    const budget = expectedMode(testInfo) === "2d" ? 4000 : Infinity;
    const count = (n: number) => Math.min(n, budget);
    const trace = FIXTURE.traces["rgb-6"];
    await page.goto("/");
    await ready(page);
    await uploadBands(page);
    await openPanel(page, testInfo);
    // A 100 x 100 opaque image gives 10,000 samples, all of them unlocked.
    const samples = FIXTURE.image.width * FIXTURE.image.height;
    const shown = () =>
      Promise.all([
        renderer(page).getAttribute("data-trace-points"),
        page
          .locator(".algorithm-stats > div")
          .filter({ hasText: "pixels visualized" })
          .locator("strong")
          .textContent(),
      ]);
    await expect
      .poll(shown)
      .toEqual([
        String(count(samples)),
        count(samples).toLocaleString("en-US"),
      ]);
    await drawnStep(page, trace.steps.length - 1);
    expectStep(await readLayers(page), trace, trace.steps.length - 1);

    // Locking a color holds its band out of the split, and only its band:
    // every other band is more than 60 RGB levels away.
    const locked = "#d04020";
    const band = FIXTURE.image.bands.find(([hex]) => hex === locked)!;
    const remaining = samples - band[1] * FIXTURE.image.width;
    await page
      .getByRole("button", {
        name: `Lock ${locked} and re-extract the rest`,
        exact: true,
      })
      .click();
    await ready(page);
    await expect
      .poll(shown)
      .toEqual([
        String(count(remaining)),
        count(remaining).toLocaleString("en-US"),
      ]);
    // In the 2D fallback filtering removed samples, yet the count stays.
    if (budget === 4000) expect(count(remaining)).toBe(count(samples));
    else expect(count(remaining)).toBeLessThan(count(samples));
    await expect(page.locator(".cube-bottomline")).toContainText("/ 5 steps");
    await drawnStep(page, 4);
    // The held-out band's position is empty; every other band still shows.
    const layers = await readLayers(page);
    const spot = trace.points.find((p) => p.hex === locked)!;
    for (const p of trace.points.filter((p) => p.hex !== locked))
      expect(Math.hypot(p.x - spot.x, p.y - spot.y)).toBeGreaterThan(8);
    expect(inked(layers.points, spot.x, spot.y, 2)).toBe(false);
    const present = trace.points.map((p) => p.hex).filter((h) => h !== locked);
    for (const hex of present) {
      const p = trace.points.find((q) => q.hex === hex)!;
      expect(inked(layers.points, p.x, p.y, 2), hex).toBe(true);
    }
  });

  test("a uniform image has one step: its points and marker, no scrubber", async ({
    page,
  }, testInfo) => {
    const color = "#2a6f97";
    await page.goto("/");
    await ready(page);
    await page.locator("input[type=file]").setInputFiles({
      name: "uniform.svg",
      mimeType: "image/svg+xml",
      buffer: svg(color),
    });
    await expect(page.locator(".image-caption")).toContainText("uniform.svg");
    await ready(page);
    await openPanel(page, testInfo);
    await drawnStep(page, 0, 1);
    await expect(page.locator(".contrast-empty")).toHaveCount(0);
    await expect(slider(page)).toHaveCount(0);
    const { points, overlay } = await readLayers(page);
    // The view is fitted to the samples, so a single color sits at its
    // center from any angle.
    const { width, height } = FIXTURE.renderer;
    const px = width / 2;
    const py = height / 2;
    expect(painted(points)).toBeGreaterThan(0);
    expect(inked(points, px, py, 2)).toBe(true);
    const [r, g, b, a] = pixel(overlay, Math.floor(px), Math.floor(py));
    expect(a).toBe(255);
    expect(
      [r, g, b].every((v, k) => Math.abs(v - channels(color)[k]) <= 2),
    ).toBe(true);
  });

  test("a shared palette and an all-locked result show the empty state", async ({
    page,
  }) => {
    await page.goto("/#p=ee5533.3355ee");
    await ready(page);
    await page.getByRole("tab", { name: "How it works" }).click();
    await expect(page.getByText("No pixels to plot yet.")).toBeVisible();
    await expect(page.locator(".algorithm-renderer canvas")).toHaveCount(0);

    await page.goto("/");
    await ready(page);
    // Each lock re-extracts the rest, so lock whichever color is next.
    for (let i = 0; i < 6; i++) {
      await page.locator(".lock-button[aria-pressed=false]").first().click();
      await ready(page);
    }
    await expect(page.locator(".lock-button[aria-pressed=true]")).toHaveCount(
      6,
    );
    await page.getByRole("tab", { name: "How it works" }).click();
    await expect(page.getByText("No pixels to plot yet.")).toBeVisible();
    await expect(page.locator(".algorithm-renderer canvas")).toHaveCount(0);
  });

  test("an unscrubbed still view shows each result's final step; a scrubbed one keeps and clamps its step", async ({
    page,
  }, testInfo) => {
    const six = FIXTURE.traces["rgb-6"];
    const eight = FIXTURE.traces["rgb-8"];
    const more = page.getByRole("button", { name: "More colors" });
    const fewer = page.getByRole("button", { name: "Fewer colors" });
    const change = async (button: typeof more) => {
      for (let i = 0; i < 2; i++) {
        await button.click();
        await ready(page);
      }
    };
    await page.goto("/");
    await ready(page);
    await uploadBands(page);
    await openPanel(page, testInfo);
    await drawnStep(page, 5, 6);
    expectStep(await readLayers(page), six, 5);
    await change(more);
    await drawnStep(page, 7, 8);
    expectStep(await readLayers(page), eight, 7);

    await scrubTo(page, 3);
    await drawnStep(page, 3);
    await change(fewer);
    await drawnStep(page, 3, 6);
    expectStep(await readLayers(page), six, 3);

    await scrubTo(page, 5);
    await change(more);
    await drawnStep(page, 5, 8);
    expectStep(await readLayers(page), eight, 5);
    await slider(page).press("End");
    await drawnStep(page, 7);
    await change(fewer);
    await drawnStep(page, 5, 6);
    expectStep(await readLayers(page), six, 5);
  });
});

test.describe("controls, with motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("the scrubber pauses autoplay, keeps its step, and Play and Replay pick up from there", async ({
    page,
  }, testInfo) => {
    const trace = FIXTURE.traces["rgb-6"];
    await page.goto("/");
    await ready(page);
    await uploadBands(page);
    await openPanel(page, testInfo);
    await expect(
      page.getByRole("button", { name: "Stop animation", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("LIVE EXTRACTION TRACE")).toBeVisible();

    // Arrow keys move the scrubber; focusing it already paused autoplay.
    await scrubTo(page, 2);
    await expect(
      page.getByRole("button", { name: "Play animation", exact: true }),
    ).toBeVisible();
    await drawnStep(page, 2);
    const held = await readLayers(page);
    expectStep(held, trace, 2);
    // Paused: two autoplay intervals later the same frame is still shown.
    await page.waitForTimeout(1600);
    await expect(renderer(page)).toHaveAttribute("data-step", "2");
    const later = await readLayers(page);
    expect(later.overlay.data.equals(held.overlay.data)).toBe(true);
    expect(later.points.data.equals(held.points.data)).toBe(true);

    // Play resumes from the chosen step rather than starting over.
    await recordFrames(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect.poll(() => recordedSteps(page)).toContain(3);
    await page
      .getByRole("button", { name: "Stop animation", exact: true })
      .click();
    const steps = await recordedSteps(page);
    expect(steps[0]).toBe(3);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(3);
    const stopped = Number(await renderer(page).getAttribute("data-step"));
    expect(stopped).toBeGreaterThanOrEqual(3);
    await drawnStep(page, stopped);
    expectStep(await readLayers(page), trace, stopped);

    // Replay starts again at the unsplit cube, from the still angle.
    await recordFrames(page);
    await page.getByRole("button", { name: "Replay", exact: true }).click();
    await expect.poll(() => recordedSteps(page)).toContain(1);
    expect((await recordedSteps(page))[0]).toBe(0);
    expectStep(await recordedFrame(page, 0), trace, 0);
  });

  test.describe("on a touch screen", () => {
    test.use({ hasTouch: true });

    test("a tap moves the scrubber and pauses autoplay", async ({
      page,
    }, testInfo) => {
      const trace = FIXTURE.traces["rgb-6"];
      await page.goto("/");
      await ready(page);
      await uploadBands(page);
      await openPanel(page, testInfo);
      await expect(page.getByText("LIVE EXTRACTION TRACE")).toBeVisible();
      const box = (await slider(page).boundingBox())!;
      await page.touchscreen.tap(
        box.x + box.width * 0.82,
        box.y + box.height / 2,
      );
      await expect(
        page.getByRole("button", { name: "Play animation", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("STATIC VIEW")).toBeVisible();
      await expect(slider(page)).toHaveValue("4");
      await drawnStep(page, 4);
      expectStep(await readLayers(page), trace, 4);
    });
  });

  test("while paused a new result keeps the step, clamped to the new trace", async ({
    page,
  }, testInfo) => {
    const six = FIXTURE.traces["rgb-6"];
    const eight = FIXTURE.traces["rgb-8"];
    const step = async (name: "More colors" | "Fewer colors") => {
      for (let i = 0; i < 2; i++) {
        await page.getByRole("button", { name }).click();
        await ready(page);
      }
    };
    await page.goto("/");
    await ready(page);
    await uploadBands(page);
    await openPanel(page, testInfo);
    await scrubTo(page, 5);
    await drawnStep(page, 5, 6);
    expectStep(await readLayers(page), six, 5);
    await step("More colors");
    await drawnStep(page, 5, 8);
    expectStep(await readLayers(page), eight, 5);

    await slider(page).focus();
    await slider(page).press("End");
    await drawnStep(page, 7);
    expectStep(await readLayers(page), eight, 7);
    await step("Fewer colors");
    await drawnStep(page, 5, 6);
    expectStep(await readLayers(page), six, 5);
  });

  test("while playing a new result starts again at step 0", async ({
    page,
  }, testInfo) => {
    const trace = FIXTURE.traces["rgb-6"];
    await page.goto("/");
    await ready(page);
    await uploadBands(page);
    await openPanel(page, testInfo);
    // Autoplay has moved past the first steps.
    await expect
      .poll(async () =>
        Number(await renderer(page).getAttribute("data-drawn-step")),
      )
      .toBeGreaterThanOrEqual(2);
    await recordFrames(page);
    await page.getByRole("button", { name: "More colors" }).click();
    await ready(page);
    await expect(page.locator(".cube-bottomline")).toContainText("/ 7 steps");
    await expect.poll(() => recordedSteps(page)).toContain(0);
    const steps = await recordedSteps(page);
    const first = steps.indexOf(0);
    // The unsplit cube is the same box whatever the color count.
    expectStep(await recordedFrame(page, first), trace, 0);
    await expect(
      page.getByRole("button", { name: "Stop animation", exact: true }),
    ).toBeVisible();
  });

  test("leaving the tab and coming back starts fresh", async ({
    page,
  }, testInfo) => {
    const trace = FIXTURE.traces["rgb-6"];
    await page.goto("/");
    await ready(page);
    await uploadBands(page);
    await openPanel(page, testInfo);
    await scrubTo(page, 4);
    await drawnStep(page, 4);
    await page.getByRole("tab", { name: "Contrast check" }).click();
    await expect(renderer(page)).toHaveCount(0);
    await recordFrames(page);
    await page.getByRole("tab", { name: "How it works" }).click();
    await expect(
      page.getByRole("button", { name: "Stop animation", exact: true }),
    ).toBeVisible();
    await expect.poll(() => recordedSteps(page)).toContain(0);
    expect((await recordedSteps(page))[0]).toBe(0);
    expectStep(await recordedFrame(page, 0), trace, 0);
  });
});
