import { test, expect, type Page } from "@playwright/test";
import { rgbToHex, sortPalette } from "../src/lib/color";
import { easeInOutCubic, mixOklab } from "../src/lib/morph";
import { ready, stageDone } from "./helpers";
import { afterStageChange } from "./stage-checks";
import {
  commit,
  frame,
  frozen,
  grid,
  hexToRgb,
  holdFrames,
  labelContrast,
  openOnClock,
  pauseClock,
  pinAnimations,
  releaseFrames,
  runTo,
  setHash,
  setSort,
} from "./morph-checks";

const black = { r: 0, g: 0, b: 0 };
const white = { r: 255, g: 255, b: 255 };

/** Where a black-to-white melt can be `elapsed` ms in, give or take a frame. */
function meltRange(elapsed: number) {
  const at = (ms: number) =>
    mixOklab(black, white, easeInOutCubic(Math.min(1, Math.max(0, ms / 400))))
      .r;
  return [at(elapsed - 16), at(elapsed + 16)];
}

async function expectMelting(page: Page, index: number, elapsed: number) {
  const { swatch } = await frame(page);
  const { r, g, b } = hexToRgb(swatch[index]);
  const [low, high] = meltRange(elapsed);
  expect(g).toBe(r);
  expect(b).toBe(r);
  expect(r).toBeGreaterThanOrEqual(low);
  expect(r).toBeLessThanOrEqual(high);
}

const FIXTURE = "/#p=000000.c04040.4060c0";

type Rect = { left: number; top: number };
const expectSameSpot = (a: Rect, b: Rect) => {
  expect(Math.abs(a.left - b.left)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(0.5);
};

/** How far each swatch's moving part sits from its slot. */
const offsets = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".swatch")].map((swatch) => {
      const motion = swatch.querySelector(".swatch-motion")!;
      const a = motion.getBoundingClientRect();
      const b = swatch.getBoundingClientRect();
      return [a.left - b.left, a.top - b.top];
    }),
  );

test("a shared palette change melts with eased timing and final text", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openOnClock(page, FIXTURE);
  await pauseClock(page);
  const start = await commit(page, () =>
    setHash(page, "#p=ffffff.c04040.4060c0"),
  );
  await expect(grid(page)).toHaveAttribute("data-morph", "running");
  // Linear timing would show gray 34 at 100 ms; the eased curve shows 0 to 3.
  expect(meltRange(100)[1]).toBeLessThan(10);

  for (const elapsed of [100, 200, 300]) {
    await runTo(page, start + elapsed);
    await pinAnimations(page);
    await frozen(page, async () => {
      await expectMelting(page, 0, elapsed);
      const first = page.locator(".swatch").first();
      await expect(first.locator(".swatch-info code")).toHaveText("#ffffff");
      await expect(first.locator(".swatch-info button")).toHaveAccessibleName(
        "Copy #ffffff",
      );
      for (const ratio of await labelContrast(page))
        expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
    // The copy payloads are already final mid-melt, the swatch's and the
    // inspector's. Copying from the inspector last also hands the
    // confirmation back, so the swatch shows its value at the next check.
    for (const button of [
      page.locator(".swatch").first().locator(".swatch-info button"),
      page.getByRole("button", { name: "Copy #ffffff from inspector" }),
    ]) {
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await button.evaluate((el: HTMLElement) => el.click());
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe("#ffffff");
    }
  }

  await runTo(page, start + 416);
  expect((await frame(page)).swatch).toEqual(["#ffffff", "#c04040", "#4060c0"]);
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
});

test("a change mid-melt starts from what is on screen without a jump", async ({
  page,
}) => {
  await openOnClock(page, FIXTURE);
  await pauseClock(page);
  const start = await commit(page, () =>
    setHash(page, "#p=ffffff.c04040.4060c0"),
  );
  await runTo(page, start + 200);
  const before = await frame(page);
  const second = await commit(page, () =>
    setHash(page, "#p=808080.4060c0.c04040"),
  );
  expect(second).toBe(start + 200);
  await pinAnimations(page);
  const after = await frame(page);

  // Every swatch survives: the melting one is retargeted, the others swap.
  expect([...after.ids].sort()).toEqual([...before.ids].sort());
  expect(after.ids).toEqual([before.ids[0], before.ids[2], before.ids[1]]);
  for (const [i, id] of before.ids.entries()) {
    const j = after.ids.indexOf(id);
    const was = hexToRgb(before.swatch[i]);
    const now = hexToRgb(after.swatch[j]);
    for (const channel of ["r", "g", "b"] as const)
      expect(Math.abs(was[channel] - now[channel])).toBeLessThanOrEqual(2);
    for (const side of ["left", "top"] as const)
      expect(
        Math.abs(before.rects[i][side] - after.rects[j][side]),
      ).toBeLessThanOrEqual(1);
  }
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id === "morph-move").length,
    ),
  ).toBe(2);

  await runTo(page, second + 200);
  expect((await frame(page)).swatch[0]).not.toBe("#808080");
  await runTo(page, second + 416);
  expect((await frame(page)).swatch[0]).toBe("#808080");
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
});

test("a sort mid-melt moves swatches without restarting the melt", async ({
  page,
}) => {
  await openOnClock(page, FIXTURE);
  await setSort(page, "hue");
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
  await pauseClock(page);
  // By hue, the gray goes last: [red, blue, black melting to white].
  const start = await commit(page, () =>
    setHash(page, "#p=ffffff.c04040.4060c0"),
  );
  const melting = (await frame(page)).ids[2];
  await runTo(page, start + 200);
  await expectMelting(page, 2, 200);
  const before = await frame(page);

  // By lightness, white leads: every swatch changes slot.
  await commit(page, () => setSort(page, "luminance"));
  await pinAnimations(page);
  const sorted = await frame(page);
  expect(sorted.ids).toEqual([melting, before.ids[0], before.ids[1]]);
  expect(sorted.hexes).toEqual(["#ffffff", "#c04040", "#4060c0"]);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id === "morph-move").length,
    ),
  ).toBe(3);
  // Positions animate from where each swatch was.
  expectSameSpot(sorted.rects[0], before.rects[2]);

  await runTo(page, start + 300);
  await expectMelting(page, 0, 300);
  await pinAnimations(page);
  const moving = await frame(page);
  expect(moving.rects[0].left).not.toBe(sorted.rects[0].left);

  await runTo(page, start + 416);
  expect((await frame(page)).swatch[0]).toBe("#ffffff");
});

test("a new photo shows only old or new colors; a shared link from a photo melts", async ({
  page,
}) => {
  await openOnClock(page, "/");
  await stageDone(page);
  const old = await page
    .locator(".swatch-select")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")!.match(/#[0-9a-f]{6}/)![0]),
    );
  // Every value written to a swatch, as it is written.
  await page.evaluate(() => {
    const w = window as unknown as { __written: string[]; __flown: string[] };
    w.__written = [];
    w.__flown = [];
    const record = () => {
      for (const el of document.querySelectorAll<HTMLElement>(".swatch"))
        w.__written.push(getComputedStyle(el).getPropertyValue("--swatch"));
    };
    new MutationObserver(record).observe(
      document.querySelector(".swatch-grid")!,
      { attributes: true, subtree: true, childList: true },
    );
    new MutationObserver((records) => {
      for (const r of records)
        for (const node of r.addedNodes)
          if ((node as HTMLElement).classList?.contains("stage-flyer"))
            w.__flown.push((node as HTMLElement).style.background);
    }).observe(document.body, { childList: true, subtree: true });
    const sample = () => {
      record();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const landings = () =>
    page
      .locator(".swatch-color")
      .evaluateAll((els) =>
        els.map((el) => Number((el as HTMLElement).dataset.stageLanding ?? 0)),
      );
  const landedBefore = await landings();
  await afterStageChange(page, () =>
    page.getByRole("button", { name: "Try Forest floor" }).click(),
  );
  const forest = [
    "#17251e",
    "#233531",
    "#29403a",
    "#30514a",
    "#337265",
    "#2c3731",
  ];
  await expect.poll(async () => (await frame(page)).hexes).toEqual(forest);
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
  const fresh = (await frame(page)).hexes;
  const { written, flown } = await page.evaluate(() => ({
    written: (window as unknown as { __written: string[] }).__written,
    flown: (window as unknown as { __flown: string[] }).__flown,
  }));
  const allowed = new Set([...old, ...fresh]);
  expect(written.length).toBeGreaterThan(0);
  expect(written.filter((hex) => !allowed.has(hex.trim()))).toEqual([]);
  // Flyers carry the new colors; every swatch lands a flyer or pulses.
  expect(flown.length).toBeGreaterThan(0);
  const freshRgb = fresh.map((hex) => {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${r}, ${g}, ${b})`;
  });
  for (const color of flown) expect(freshRgb).toContain(color);
  const landedAfter = await landings();
  landedAfter.forEach((count, i) =>
    expect(count).toBeGreaterThan(landedBefore[i] ?? 0),
  );

  // Opening a share link from a photo palette melts as usual.
  await pauseClock(page);
  const { swatch: shown } = await frame(page);
  const start = await commit(page, () =>
    setHash(page, "#p=ff0000.ffffff.0000ff.ffff00.00ffff.ff00ff"),
  );
  await runTo(page, start + 200);
  const middle = (await frame(page)).swatch;
  const ends = new Set([
    ...shown,
    "#ff0000",
    "#ffffff",
    "#0000ff",
    "#ffff00",
    "#00ffff",
    "#ff00ff",
  ]);
  expect(middle.filter((hex) => !ends.has(hex)).length).toBeGreaterThan(0);
});

test("the palette keeps full opacity while new colors are found", async ({
  page,
}) => {
  await page.goto("/");
  await stageDone(page);
  await page.evaluate(() => {
    const w = window as unknown as { __busy: number[] };
    w.__busy = [];
    const sample = () => {
      if (!document.querySelector(".palette-fieldset.is-busy")) return;
      for (const el of document.querySelectorAll(".swatch, .swatch *")) {
        let opacity = 1;
        for (let node: Element | null = el; node; node = node.parentElement)
          opacity *= Number(getComputedStyle(node).opacity);
        if (el.matches(".swatch, .swatch-motion, .swatch-color"))
          w.__busy.push(opacity);
      }
    };
    new MutationObserver(sample).observe(
      document.querySelector("#workspace")!,
      { attributeFilter: ["aria-busy"], subtree: true, attributes: true },
    );
    const loop = () => {
      sample();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.getByRole("button", { name: "More colors", exact: true }).click();
  await expect(page.locator(".swatch")).toHaveCount(7);
  await ready(page);
  const samples = await page.evaluate(
    () => (window as unknown as { __busy: number[] }).__busy,
  );
  expect(samples.length).toBeGreaterThan(0);
  expect(new Set(samples)).toEqual(new Set([1]));
});

test("reduced motion commits final values with no morph animation or frames", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openOnClock(page, FIXTURE);
  await pauseClock(page);
  const requested = await grid(page).getAttribute("data-morph-raf");
  await holdFrames(page);
  await commit(page, () => setHash(page, "#p=ffffff.4060c0.c04040"));
  const shown = await frame(page);
  expect(shown.swatch).toEqual(["#ffffff", "#4060c0", "#c04040"]);
  expect(shown.label[0]).toBe("rgb(20, 18, 12)");
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
  const morphAnimations = () =>
    page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id.startsWith("morph-"))
          .length,
    );
  expect(await morphAnimations()).toBe(0);
  await releaseFrames(page);
  await page.clock.runFor(500);
  expect(await morphAnimations()).toBe(0);
  expect(await grid(page).getAttribute("data-morph-raf")).toBe(requested);
});

test("turning on reduced motion mid-morph lands it at once", async ({
  page,
}) => {
  await openOnClock(page, FIXTURE);
  await pauseClock(page);
  const start = await commit(page, () =>
    setHash(page, "#p=ffffff.4060c0.c04040"),
  );
  await runTo(page, start + 100);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id === "morph-move").length,
    ),
  ).toBe(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
  const shown = await frame(page);
  expect(shown.swatch).toEqual(["#ffffff", "#4060c0", "#c04040"]);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id.startsWith("morph-"))
          .length,
    ),
  ).toBe(0);
  for (const offset of await offsets(page)) expect(offset).toEqual([0, 0]);
});

test("a sort slides swatches to their new slots, keeping identity and focus", async ({
  page,
}) => {
  const colors = ["5f92ad", "352114", "d27108", "84afbd", "975112", "7a7769"];
  await openOnClock(page, `/#p=${colors.join(".")}`);
  await pauseClock(page);
  const before = await frame(page);
  const expected = sortPalette(
    colors.map((c) => hexToRgb(`#${c}`)),
    "hue",
  ).map(rgbToHex);
  // Focus a copy button in a swatch whose node React has to move (a node
  // placed after one that used to follow it), and tag it.
  let furthest = 0;
  const relocated = expected
    .map((hex) => before.hexes.indexOf(hex))
    .filter((old) => {
      if (old >= furthest) furthest = old;
      return old < furthest;
    });
  expect(relocated.length).toBeGreaterThan(0);
  const moved = relocated[0];
  const focused = page
    .locator(".swatch")
    .nth(moved)
    .locator(".swatch-info button");
  await focused.focus();
  await focused.evaluate((el) => (el.dataset.tagged = "yes"));

  const start = await commit(page, () => setSort(page, "hue"));
  const rects: Awaited<ReturnType<typeof frame>>["rects"][] = [];
  for (const elapsed of [0, 150, 300]) {
    await runTo(page, start + elapsed);
    await pinAnimations(page);
    const shot = await frozen(page, () => frame(page));
    expect(shot.hexes).toEqual(expected);
    // No melt was running, so every color is already final.
    expect(shot.swatch).toEqual(expected);
    rects.push(before.ids.map((id) => shot.rects[shot.ids.indexOf(id)]));
  }
  const after = await frame(page);
  const movers = before.ids.filter((id, i) => after.ids.indexOf(id) !== i);
  expect(movers.length).toBeGreaterThan(0);
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.id === "morph-move")
      .map(
        (a) =>
          (
            (a.effect as KeyframeEffect).target as HTMLElement
          ).closest<HTMLElement>(".swatch")!.dataset.swatchId,
      ),
  );
  expect(running.sort()).toEqual([...movers].sort());
  for (const id of movers) {
    const i = before.ids.indexOf(id);
    expectSameSpot(rects[0][i], before.rects[i]);
    expect(rects[1][i]).not.toEqual(rects[0][i]);
    expect(rects[2][i]).not.toEqual(rects[1][i]);
  }

  // Each move ends exactly on its new slot.
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.id === "morph-move")
      .forEach((a) => a.finish()),
  );
  for (const offset of await offsets(page)) expect(offset).toEqual([0, 0]);

  // The same node, still focused, inside the same swatch.
  expect(
    await page.evaluate(
      () => (document.activeElement as HTMLElement).dataset.tagged,
    ),
  ).toBe("yes");
  const id = before.ids[moved];
  expect(
    await page.evaluate(
      () =>
        (document.activeElement as HTMLElement).closest<HTMLElement>(".swatch")!
          .dataset.swatchId,
    ),
  ).toBe(id);
});

test("selection follows one swatch by its ID, even among repeated colors", async ({
  page,
}) => {
  const selectedIds = () =>
    page
      .locator(".swatch.selected")
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.swatchId),
      );
  const pressed = page.locator('.swatch-select[aria-pressed="true"]');
  const inspector = page.locator(".inspector button").first();

  await page.goto("/#p=5f92ad.352114.5f92ad");
  await expect(page.locator(".swatch")).toHaveCount(3);
  const ids = await page
    .locator(".swatch")
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.swatchId),
    );
  expect(await selectedIds()).toEqual([ids[0]]);
  await expect(pressed).toHaveCount(1);

  // The second #5f92ad, not both.
  await page.locator(".swatch-select").nth(2).click();
  expect(await selectedIds()).toEqual([ids[2]]);
  await expect(pressed).toHaveCount(1);
  await expect(inspector).toHaveAccessibleName("Copy #5f92ad from inspector");

  // A sort moves it; the selection moves with it.
  await page.getByLabel("Sort palette", { exact: true }).selectOption("hue");
  await expect
    .poll(() =>
      page
        .locator(".swatch")
        .evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).dataset.swatchId),
        ),
    )
    .not.toEqual(ids);
  expect(await selectedIds()).toEqual([ids[2]]);
  await expect(pressed).toHaveCount(1);

  // A photo: the selection survives a recount while its swatch does, and a
  // new photo starts again at the first swatch.
  await page.goto("/");
  await stageDone(page);
  await expect(page.locator(".swatch")).toHaveCount(6);
  await page.locator(".swatch-select").nth(4).click();
  const chosen = await selectedIds();
  await page.getByRole("button", { name: "More colors", exact: true }).click();
  await expect(page.locator(".swatch")).toHaveCount(7);
  await ready(page);
  expect(await selectedIds()).toEqual(chosen);
  const firstHex = () =>
    page
      .locator(".swatch-select")
      .first()
      .getAttribute("aria-label")
      .then((label) => label!.match(/#[0-9a-f]{6}/)![0]);
  const dunes = await firstHex();
  await page.getByRole("button", { name: "Try Forest floor" }).click();
  await expect.poll(firstHex).not.toBe(dunes);
  await ready(page);
  const first = await page
    .locator(".swatch")
    .first()
    .evaluate((el) => (el as HTMLElement).dataset.swatchId);
  expect(await selectedIds()).toEqual([first]);
  await expect(pressed).toHaveCount(1);
  await expect(inspector).toHaveAccessibleName(
    `Copy ${await firstHex()} from inspector`,
  );
});

test("the first palette and a pure sort run the morph without color frames", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await stageDone(page);
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
  // Nothing melts on a first palette, so the page load spends no frames on it.
  await expect(grid(page)).toHaveAttribute("data-morph-raf", "0");
  await page.getByLabel("Sort palette").selectOption("luminance");
  await expect(grid(page)).toHaveAttribute("data-morph", "running");
  await expect(grid(page)).toHaveAttribute("data-morph", "idle");
  await expect(grid(page)).toHaveAttribute("data-morph-raf", "0");
});
