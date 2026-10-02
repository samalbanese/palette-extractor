import { expect, type BrowserContext, type Page } from "@playwright/test";
import { frame } from "./morph-checks";

/**
 * Holds every glow crossfade at its first frame from the moment it starts,
 * so a test decides where it stands (with `fadeTo`, or `pinAnimations` on the
 * page clock) instead of the real document timeline. Must run before the
 * page loads, and before `openOnClock` so its stamping wraps this.
 */
export async function holdFades(page: Page) {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      ...args: Parameters<Element["animate"]>
    ) {
      const animation = animate.apply(this, args);
      if (animation.id.startsWith("atmosphere-")) animation.pause();
      return animation;
    };
  });
}

/** Sets every held crossfade to `ms` into its run. */
export async function fadeTo(page: Page, ms: number) {
  await page.evaluate(async (ms) => {
    const all = document
      .getAnimations()
      .filter((a) => a.id.startsWith("atmosphere-"));
    for (const a of all) a.currentTime = ms;
    await Promise.all(all.map((a) => a.ready));
  }, ms);
}

/** Lets every held crossfade run to its end. */
export async function finishFades(page: Page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations())
      if (a.id.startsWith("atmosphere-")) a.finish();
  });
}

export const layers = (page: Page) => page.locator(".atmosphere-layer");

/** What the glow is showing, and whether anything above it alters blending. */
export function glow(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".atmosphere")!;
    const ancestors: string[] = [];
    for (let node = container.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.mixBlendMode !== "normal" ||
        style.filter !== "none" ||
        style.backdropFilter !== "none" ||
        Number(style.opacity) < 1
      )
        ancestors.push(node.tagName);
    }
    return {
      ancestors,
      container: getComputedStyle(container).opacity,
      layers: [
        ...container.querySelectorAll<HTMLElement>(".atmosphere-layer"),
      ].map((layer) => {
        const style = getComputedStyle(layer);
        const blobs = [...layer.children].map((blob) => {
          const s = getComputedStyle(blob);
          return {
            opacity: s.opacity,
            blend: s.mixBlendMode,
            backdrop: s.backdropFilter,
            filter: s.filter,
            image: s.backgroundImage,
          };
        });
        return {
          colors: layer.dataset.colors!,
          opacity: Number(style.opacity),
          blend: style.mixBlendMode,
          backdrop: style.backdropFilter,
          blobs,
        };
      }),
    };
  });
}

/** Everything a frozen frame must hold still, the glow's layers included. */
export async function still(page: Page) {
  return {
    ...(await frame(page)),
    atmosphere: (await glow(page)).layers.map(
      (layer) => `${layer.colors} ${layer.opacity}`,
    ),
  };
}

/** Runs `read` on a frozen frame, failing if anything moved while it ran. */
export async function frozenFrame<T>(page: Page, read: () => Promise<T>) {
  const before = await still(page);
  const result = await read();
  expect(await still(page)).toEqual(before);
  return result;
}

/** Hides everything but the glow without changing layout. */
export const onlyAtmosphere = (page: Page) =>
  page.addStyleTag({
    content: `
      body * { visibility: hidden !important; }
      .atmosphere, .atmosphere * { visibility: visible !important; }
    `,
  });

/** Hides the glow too, leaving the bare page. */
export const nothingVisible = (page: Page) =>
  page.addStyleTag({
    content: `.atmosphere, .atmosphere * { visibility: hidden !important; }`,
  });

/**
 * The page's pixels, decoded in a separate blank page so the page under test
 * is not touched. Returns RGBA bytes.
 */
export async function pixels(
  page: Page,
  context: BrowserContext,
  options: Parameters<Page["screenshot"]>[0] = {},
) {
  const png = await page.screenshot(options);
  const decoder = await context.newPage();
  const raw = await decoder.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let text = "";
    for (let i = 0; i < data.length; i += 0x8000)
      text += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { width: image.width, height: image.height, data: btoa(text) };
  }, png.toString("base64"));
  await decoder.close();
  return { ...raw, data: Buffer.from(raw.data, "base64") };
}
