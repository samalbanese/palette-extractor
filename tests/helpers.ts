import { expect, type Page } from "@playwright/test";

export async function ready(page: Page) {
  await expect(page.locator("#workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".swatch").first()).toBeVisible();
}

// Contrast is only meaningful once entrance animations finish; mid-fade
// swatches blend with the page and read darker than they render at rest.
export async function settled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" ||
          a.effect?.getTiming().iterations === Infinity,
      ),
  );
}

export const svg = (color: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/></svg>`,
  );

/** Pixel size read from a PNG or JPEG header. Throws on anything else,
    so an HTML fallback page served in place of an image fails loudly. */
export function imageSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.readUInt32BE(0) === 0x89504e47)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error("Not a PNG or JPEG");
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("Corrupt JPEG marker");
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        height: bytes.readUInt16BE(i + 5),
        width: bytes.readUInt16BE(i + 7),
      };
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw new Error("No JPEG frame header");
}
