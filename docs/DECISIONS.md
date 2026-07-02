# Decisions

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
