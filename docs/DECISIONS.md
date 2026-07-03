# Decisions

## 2026-07-03 — v1.1 (stretch goals)

- **Own median-cut quantizer replaces the `quantize` library.** The spec's
  hardest stretch goal, and it unlocks color locking: we exclude pixels near
  locked colors before quantizing, which a black-box library can't do. Kept
  MMCQ's two proven behaviors: hybrid scoring (population for early splits,
  population x volume for later ones, so small accent colors surface) and
  gap-seeking cut placement (cutting at the raw pixel median mixes clusters
  into muddy averages — our tests caught this on the first implementation).
- **URL paste uses images.weserv.nl as a CORS fallback proxy.** Most image
  hosts block cross-origin canvas reads, so direct-only would fail for the
  majority of pasted URLs. Tradeoff disclosed in the footer: pasted URLs
  (not uploaded files) are fetched from the web, via the proxy when needed.
  Uploads still never leave the browser.
- **Lock exclusion radius = 60 RGB Euclidean distance.** Big enough that
  re-extraction doesn't return a near-duplicate of a locked color, small
  enough not to erase distinct neighbors. Falls back to all pixels if the
  exclusion would leave nothing.
- **Contrast pairs shown once, lighter color as background.** WCAG contrast
  is symmetric, so listing both orientations would double the list without
  adding information.


## 2026-07-02 — v1

- **`quantize` package instead of the ColorThief wrapper.** Same
  battle-tested median-cut algorithm (it is ColorThief's engine), but we
  control the canvas downscale ourselves (matches the spec's described
  mechanism) and avoid ColorThief's ESM/bundler friction with Vite.
- **Swatch label threshold = 0.179 relative luminance.** That is the point
  where dark and light text have mathematically equal WCAG contrast; a first
  pass at 0.4 made mid-tone swatches (salmon, sage) get low-contrast light
  text. Guarded by unit tests on #d18882 and #7d857a.
- **Tailwind export emits a v4 `@theme` block**, not a v3 `tailwind.config.js`
  object — v4 is current. Revisit if Sam needs v3 output.
- **Sample image is an inline SVG scene** (dusk coast) rather than a bundled
  photo: tiny, license-free, and produces a rich 6-color palette.
- **Stretch goal included by Sam's choice:** palette sorting (as found /
  by hue / by light). Other stretch goals from spec section 7 deferred.
- **Transparent pixels are skipped during extraction; near-white pixels are
  kept** (ColorThief drops them). A palette tool should report white if the
  image is genuinely white.
