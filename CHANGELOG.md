# Changelog

## 2026-07-18 — v1.2.0: portfolio wow pass

Built by Codex (gpt-5.6-sol) from a Fable 5 spec, then audited and enhanced
by Fable per the delegate + enhance routing.

### Added

- **"How it works" visualization** (`src/components/PixelSpace.tsx`): a
  toolbar toggle opens an animated canvas plotting the image's sampled
  pixels in a slowly rotating RGB color cube while the median-cut trace
  replays — wireframe boxes split step by step until each final box's
  average becomes a palette dot (sized by how much of the image it covers).
  Honors `prefers-reduced-motion` (static final frame), pauses when the tab
  is hidden, and shows an explanatory empty state when every color is
  locked (nothing was extracted).
- **Dominance-weighted swatches**: `medianCut` now reports per-color pixel
  populations; swatch widths (heights on mobile) scale with how much of the
  image each color covers, on a square-root curve so accents stay visible.
- **Color names** (`src/lib/names.ts`): every swatch gets a nearest-match
  designer name ("Dusty Rose", "Navy", "Spruce") from a ~140-entry curated
  table; names are also included in the JSON export and the PNG card.
- **Share links** (`src/lib/share.ts`): the Share button copies a URL with
  the palette encoded in the hash (`#p=aabbcc.112233...`). Opening one
  renders exactly that palette as locked swatches — unlocking re-extracts
  around the rest. Decoder strictly accepts 4–10 six-digit hex colors only.
- **PNG palette card** (`src/lib/paletteCard.ts`): "Save PNG" downloads a
  1600×1000 palette poster — swatch columns with name + hex in
  luminance-aware ink, source image name and app credit in a footer band.
- **SCSS and SVG export formats** alongside CSS variables, Tailwind, and
  JSON. The SVG is a standalone paste-ready swatch strip with labeled hex
  values.
- **Dynamic favicon** (`src/lib/favicon.ts`): the browser-tab icon becomes
  a striped rendering of the current palette on every extraction.

### Fixed (caught in the Fable audit of the Codex build)

- Share-link decoder accepted 3–12 colors while the app's count range is
  4–10; a 3-color link would silently gain a sample-image color and an
  11-plus-color link would silently drop colors. Decoder now matches the
  app range exactly (regression-locked in `share.test.ts`).
- Swatch React keys were bare hex values, which could collide if a locked
  color matched an extracted one; now hex + position.
- PixelSpace canvas composition on wide screens (cube floated tiny in a
  full-width canvas); canvas is now width-capped, points enlarged, and a
  faint full-RGB-cube frame grounds the rotation.

### Verified

- 44 unit tests passing (new: names, share round-trip + malformed inputs,
  SCSS/SVG exports, weighted median-cut invariants).
- `npm run build` (tsc + Vite) clean.
- Rendered verification via Playwright screenshot + driven browser session:
  weighted named swatches, the PixelSpace panel animating with cube frame
  and split boxes, and a share-link cold load rendering exactly the 4
  encoded colors as locked swatches with correct names.
- Deliberately not shipped: live-camera extraction (permission-gated and
  unverifiable headlessly — logged as a future idea, not silently dropped).


## 2026-07-03 — v1.1.0: all stretch goals

### Added

- **From-scratch median-cut quantizer** (`src/lib/medianCut.ts`) replacing
  the `quantize` library — the app now has zero runtime dependencies beyond
  React. Uses MMCQ-style hybrid scoring (population first, then
  population x volume) and gap-seeking cut placement.
- **WCAG contrast helper**: a "Readable pairs" toolbar toggle opens a panel
  showing every palette pair meeting at least 3:1 contrast, with exact
  ratios and AAA / AA / AA-Large levels. Clicking a pair copies
  `color` + `background-color` CSS.
- **Paste an image URL**: pasting a URL extracts from that image. Tries the
  URL directly; falls back to the images.weserv.nl proxy when the host
  blocks cross-origin access. Footer copy updated to disclose this.
- **Color locking**: a lock control on each swatch keeps that color while
  the rest of the palette re-extracts around it — pixels near locked colors
  (RGB distance < 60) are excluded before quantizing. Locks survive count
  changes and new images.

### Fixed (caught by our own tests before shipping)

- Naive median-index splitting produced muddy mixed colors when a cut
  landed inside a dominant cluster; replaced with MMCQ-style cut placement
  that seeks the gap between clusters. Regression-locked by
  `medianCut.test.ts` (cluster recovery, dominant-first ordering,
  small-accent detection).

### Verified

- 27 unit tests passing (12 new: quantizer + contrast math).
- 31/31 end-to-end browser checks, including: locked color survives
  re-extraction and count changes, contrast pairs show correct ratio/level
  and copy valid CSS, a real remote image URL paste extracts a palette over
  the network, and a bad URL shows a friendly error.

### Notes

- Windows clipboard round-trips convert `\n` to `\r\n`; a test regex needed
  loosening but app output is unaffected.


## 2026-07-02 — v1.0.0

### Added

- Full version 1 build per `PALETTE_EXTRACTOR_SPEC.md`: upload (drag-and-drop
  anywhere on the page, click-to-browse, clipboard paste), extraction via
  offscreen canvas downscale (longest edge 160px) + `quantize` median-cut,
  swatch display with hex/RGB/HSL, single-value copy with per-button
  confirmation, "copy all" export (CSS variables, Tailwind v4 `@theme`, JSON),
  color-count stepper (4–10, default 6), and a built-in SVG sample image that
  produces a palette on first load.
- Stretch goal (approved by Sam): palette sorting — as found, by hue
  (grays grouped last), or by lightness.
- Luminance-aware swatch labels using WCAG relative luminance with the 0.179
  threshold (the point where dark and light text have equal contrast).
- Unit tests (Vitest, 15 passing): color conversions, achromatic edge cases,
  label contrast selection including tricky mid-tones (#d18882, #7d857a),
  palette sorting, and export validity for all three formats.
- Friendly error states: non-image files, unreadable images, fully
  transparent images.

### Verified

- End-to-end browser run (Playwright script, 19/19 checks): sample palette on
  load, clipboard contents for every copy action, confirmation appears and
  reverts, count stepper bounds, all three "copy all" formats paste-ready
  (JSON parsed, CSS `:root` block, Tailwind `@theme` block), sorting correct
  and lossless, upload replaces the palette, non-image upload shows an error,
  keyboard Enter copies.
- Desktop (1440px) and phone (390px) screenshots reviewed.

### Implementation notes

- Used the `quantize` package (ColorThief's internal median-cut engine)
  directly with our own canvas pipeline instead of the ColorThief wrapper —
  same established algorithm, matches the spec's described mechanism, and
  avoids ColorThief's ESM/bundler friction with Vite.
- Tailwind export targets v4 (`@theme` block) since that is current Tailwind.
