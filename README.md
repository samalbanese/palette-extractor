# Palette Extractor

Upload an image, get its color palette. Runs entirely in the browser — no
backend, no keys, no server cost.

**Live features**

- Drag-and-drop, click-to-browse, or paste an image from the clipboard
- Median-cut color quantization (the algorithm inside ColorThief) on a
  downscaled offscreen canvas
- 4–10 dominant colors (default 6) shown as large swatches
- One-click copy for hex, RGB, and HSL with visible confirmation
- "Copy all" as CSS variables, a Tailwind v4 `@theme` block, or JSON
- Sort the palette as-found, by hue, or by lightness
- Labels switch between dark and light ink based on each swatch's WCAG
  relative luminance, so they stay readable on any color
- A built-in sample image produces a full palette on load

## Stack

React 18 · Vite · Tailwind CSS 4 · [`quantize`](https://www.npmjs.com/package/quantize) · TypeScript · Vitest

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests (color math, exports)
npm run build    # typecheck + production build to dist/
```

## Deploy

Cloudflare Pages, connected to this GitHub repository:

- Build command: `npm run build`
- Build output directory: `dist`
- No environment variables needed

## Project docs

- `PALETTE_EXTRACTOR_SPEC.md` — the original specification
- `VISION.md` — plain-language goals and non-goals
- `CLAUDE.md` — working notes for AI agents
