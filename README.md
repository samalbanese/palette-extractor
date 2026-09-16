# Palette Extractor

**Color, pulled into focus.** A private color studio that takes an image from inspiration to usable design values. Upload a photo, explore its palette, see it applied to an identity, and take the colors straight into your next project.

[Open the live app](https://palette-extractor.samalbanese.workers.dev/)

![Palette Extractor color studio with a desert photograph and its extracted colors](.github/studio.webp)

## Explore the palette

- **Start immediately.** Three bundled sample moods demonstrate the tool without an upload.
- **Bring your own image.** Upload, drop a file anywhere, paste an image, or load a public image URL.
- **Find and keep your colors.** Request 4–10 colors, pin favorites while re-extracting around them, sort by hue or lightness, and copy HEX, RGB, or HSL values.
- **Understand the balance.** A distribution strip and percentages show each quantized color group's share of the sampled image. Pinned palettes deliberately hide distribution, since their colors may come from different images.
- **See it in context.** An editorial identity responds to the palette, with suggested surface, text, and accent roles. Reverse light and dark to explore another direction. Low-contrast palettes get an honest explanation instead of an unreadable preview.
- **Check readability.** Compare actual WCAG 2 contrast ratios and copy a text/background pair as CSS. Large-text-only pairs are labeled separately.
- **Watch the algorithm.** A live RGB cube plots up to 3,000 sampled pixels and animates median-cut partitions. Static view, replay, reduced-motion preferences, and off-screen suspension are supported.
- **Take it with you.** Preview, copy, or download CSS variables, Tailwind v4 theme tokens, SCSS, SVG, or JSON. Save a PNG palette card or share a compact color-only link, including one-color palettes.

## How extraction works

The browser downsizes the image to a maximum edge of 320 pixels and ignores mostly transparent pixels. A dedicated Web Worker runs a from-scratch median-cut quantizer so the interface stays responsive. It first favors populous groups, then accounts for volume in RGB space to preserve smaller, distinct accents.

Each final group selects the sampled pixel nearest its average, rather than inventing an average color between clusters. These are colors from the **downscaled sample**; resizing can blend original pixels. Quantization is an approximation, and a simple image may return fewer colors than requested.

Locking excludes nearby colors before finding the remaining swatches. Stale image requests are discarded, superseded workers are terminated, and failed uploads leave the last successful palette available.

## Privacy and architecture

React 18, TypeScript, Vite, Tailwind CSS, Canvas, and Web Workers. No runtime dependencies beyond React. No accounts, backend, database, API keys, or analytics. Bundled images and self-hosted fonts mean the default experience makes no external requests.

Local uploads never leave the browser. **Public image URLs are different:** they are fetched from their host and, when direct cross-origin loading fails, through the `images.weserv.nl` proxy. Shared links contain the color values only, never the source image.

## Run locally

Node.js 20 or later (22+ recommended).

```sh
npm ci
npm run dev
npm run build
npm test
```

Browser tests exercise uploads, drag and paste, URL loading, copy formats, downloads, sharing, pinning, keyboard tabs, reduced motion, responsive layouts, and automated accessibility checks.

```sh
npx playwright install chromium
npm run test:e2e
```

To reuse an installed Chromium browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its full executable path. Production files are written to `dist/` and can be deployed to a static host, including Cloudflare Pages or Workers Static Assets.

## Credits

Sample photography: [Andrew Svk](https://unsplash.com/photos/0s9oD70F-l4) and [Domenico Gentile](https://unsplash.com/photos/N7Q0Ir-hXeA), under the [Unsplash License](https://unsplash.com/license). The coastal illustration is included in this repository. Schibsted Grotesk and Spline Sans Mono are self-hosted under the SIL Open Font License; license files are in `public/fonts/`.

Contrast guidance follows [W3C's WCAG contrast criteria](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). A color-pair check does not certify an entire design's accessibility.
