import { test, expect } from "@playwright/test";
import { host } from "./stage-checks";

test.use({ viewport: { width: 390, height: 844 } });
for (let run = 1; run <= 3; run++)
  test(`intro completes within the navigation deadline, run ${run}`, async ({
    page,
    context,
  }, testInfo) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (10 * 1000 * 1000) / 8,
      uploadThroughput: (10 * 1000 * 1000) / 8,
    });
    // Counts chips as they enter the page, so an intro that jumps straight
    // to its end cannot pass on timing alone.
    // Also notes when the last swatch waiting for its color is filled.
    await page.addInitScript(() => {
      const win = window as unknown as {
        __flyers: number;
        __slots: boolean;
        __filledAt: number | null;
      };
      win.__flyers = 0;
      win.__slots = false;
      win.__filledAt = null;
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (node instanceof HTMLElement && node.matches(".stage-flyer"))
              win.__flyers++;
        const waiting = !!document.querySelector(".swatch[data-slot]");
        if (waiting) win.__slots = true;
        else if (win.__slots) win.__filledAt ??= performance.now();
      }).observe(document, {
        childList: true,
        subtree: true,
        attributeFilter: ["data-slot"],
      });
    });
    await page.goto("/");
    await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/);
    const startedAt = Number(
      await host(page).getAttribute("data-stage-started-at"),
    );
    console.log(`THROTTLED_STARTED_AT run=${run} ms=${startedAt}`);
    const doneAt = Number(await host(page).getAttribute("data-stage-done-at"));
    console.log(`THROTTLED_DONE_AT run=${run} ms=${doneAt}`);
    await testInfo.attach("done-at", {
      body: String(doneAt),
      contentType: "text/plain",
    });
    expect(doneAt).toBeLessThanOrEqual(3500);
    const slots = await page.evaluate(() => {
      const win = window as unknown as {
        __slots: boolean;
        __filledAt: number | null;
      };
      return { seen: win.__slots, filledAt: win.__filledAt };
    });
    console.log(`THROTTLED_FILLED_AT run=${run} ms=${slots.filledAt}`);
    expect(slots.seen).toBe(true);
    expect(slots.filledAt).not.toBeNull();
    expect(slots.filledAt!).toBeLessThanOrEqual(3400);
    // The shortest intro is 1,200 ms; one frame of slack.
    expect(startedAt).toBeGreaterThan(0);
    expect(doneAt - startedAt).toBeGreaterThanOrEqual(1150);
    expect(
      await page.evaluate(
        () => (window as unknown as { __flyers: number }).__flyers,
      ),
    ).toBeGreaterThan(0);
    const result = await page.locator(".swatch").evaluateAll((elements) =>
      elements.map((el) => {
        const color = el.querySelector<HTMLElement>(".swatch-color")!;
        const box = color.getBoundingClientRect();
        return {
          opacity: getComputedStyle(el).opacity,
          colorOpacity: getComputedStyle(color).opacity,
          visible:
            box.top < innerHeight &&
            box.bottom > 0 &&
            box.left < innerWidth &&
            box.right > 0,
          landed: Number(color.dataset.stageLanding ?? 0),
          running: el
            .getAnimations({ subtree: true })
            .filter(
              (a) =>
                a.playState === "running" &&
                a.effect?.getTiming().iterations !== Infinity,
            ).length,
        };
      }),
    );
    expect(result.length).toBe(6);
    for (const swatch of result) {
      expect(swatch.opacity).toBe("1");
      expect(swatch.colorOpacity).toBe("1");
      expect(swatch.running).toBe(0);
      if (swatch.visible) expect(swatch.landed).toBeGreaterThan(0);
    }
  });

for (const width of [390, 1440])
  test(`the stage download starts after the photo's largest paint at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await expect(host(page)).toHaveAttribute("data-stage-done-at", /\d/);
    const timing = await page.evaluate(
      () =>
        new Promise<{ photo: number | null; stage: number | null }>(
          (resolve) => {
            const image = document.querySelector(".source-frame > img");
            // No entry at all would otherwise hang until the test timeout.
            const none = setTimeout(
              () => resolve({ photo: null, stage: null }),
              5000,
            );
            new PerformanceObserver((list, observer) => {
              observer.disconnect();
              clearTimeout(none);
              const paint = list
                .getEntries()
                .find(
                  (entry) =>
                    (entry as LargestContentfulPaint).element === image,
                );
              const stage = performance
                .getEntriesByType("resource")
                .find((entry) => /\/Stage-[^/]*\.js$/.test(entry.name));
              resolve({
                photo: paint ? paint.startTime : null,
                stage: stage ? stage.startTime : null,
              });
            }).observe({ type: "largest-contentful-paint", buffered: true });
          },
        ),
    );
    console.log(`STAGE_AFTER_LCP width=${width} ${JSON.stringify(timing)}`);
    expect(timing.photo).not.toBeNull();
    expect(timing.stage).not.toBeNull();
    expect(timing.stage!).toBeGreaterThanOrEqual(timing.photo!);
  });
