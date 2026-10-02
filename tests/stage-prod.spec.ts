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
