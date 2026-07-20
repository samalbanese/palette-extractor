# Palette Extractor

Upload an image, get its color palette. Runs entirely in the browser: no
backend, no keys, no server cost.

**Live features**

- Drag-and-drop, click-to-browse, paste an image from the clipboard, or
  paste an image URL (fetched via the images.weserv.nl proxy when the host
  blocks direct access)
- From-scratch median-cut color quantization on a downscaled offscreen canvas
- 4–10 dominant colors (default 6) shown as large swatches
- Lock a color to keep it while the rest of the palette re-extracts around it
- One-click copy for hex, RGB, and HSL with visible confirmation
- "Copy all" as CSS variables, a Tailwind v4 `@theme` block, SCSS
  variables, a standalone SVG swatch strip, or JSON (with color names)
- Swatch sizes reflect dominance. Each color's share of the image sets its
  width, and every swatch carries a designer-friendly name ("Dusty Rose")
- "How it works": an animated view of the image's pixels plotted in a
  rotating RGB color cube while the median-cut algorithm visibly splits it
  into the final palette
- Share a palette as a link (a `#p=...` hash that opens as locked swatches
  anyone can riff on) or download it as a designed PNG palette card
- Sort the palette as-found, by hue, or by lightness
- "Readable pairs" panel: which palette colors meet WCAG contrast as
  text/background, with ratios and AAA / AA / AA-Large levels; click a pair
  to copy it as CSS
- Labels switch between dark and light ink based on each swatch's WCAG
  relative luminance, so they stay readable on any color
- A built-in sample image produces a full palette on load

## Stack

React 18, Vite, Tailwind CSS 4, TypeScript, and Vitest. No other runtime
dependencies; quantization is implemented from scratch in `src/lib/medianCut.ts`.

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
