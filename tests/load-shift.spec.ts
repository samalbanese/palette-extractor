import { test, expect } from "@playwright/test";
import { host } from "./stage-checks";

/** Records every layout shift from the start of the load. */
const recordShifts = () => {
  const win = window as unknown as {
    __shifts: { value: number; nodes: string[] }[];
  };
  win.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as {
      value: number;
      hadRecentInput: boolean;
      sources: { node?: Node }[];
    }[])
      if (!entry.hadRecentInput)
        win.__shifts.push({
          value: entry.value,
          nodes: entry.sources.map((source) =>
            source.node instanceof Element
              ? source.node.className || source.node.tagName
              : String(source.node?.nodeName),
          ),
        });
  }).observe({ type: "layout-shift", buffered: true });
};

// Lighthouse's phone and desktop screens, plus every layout breakpoint.
for (const viewport of [
  { width: 412, height: 823 },
  { width: 1350, height: 940 },
  { width: 390, height: 844 },
  { width: 580, height: 900 },
  { width: 581, height: 900 },
  { width: 850, height: 900 },
  { width: 851, height: 900 },
  { width: 1150, height: 900 },
  { width: 1151, height: 900 },
  { width: 1449, height: 900 },
  { width: 1450, height: 900 },
])
  test(`the first palette arrives without moving the page at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(recordShifts);
    await page.goto("/");
    await expect(host(page)).toHaveAttribute("data-stage-phase", "done", {
      timeout: 15000,
    });
    await expect(page.locator(".swatch")).toHaveCount(6);
    // The grid holds room for the default palette before it arrives.
    const grid = await page.locator(".swatch-grid").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      reserved: parseFloat(getComputedStyle(el).minHeight),
    }));
    expect(grid.reserved).toBeGreaterThanOrEqual(grid.height - 0.5);
    const shifts = await page.evaluate(
      () =>
        (
          window as unknown as {
            __shifts: { value: number; nodes: string[] }[];
          }
        ).__shifts,
    );
    const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
    expect(total, JSON.stringify(shifts)).toBeLessThan(0.001);
  });
