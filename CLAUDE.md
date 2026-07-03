# CLAUDE.md — Palette Extractor

## What this is

A small, client-side-only web app: upload an image, get its dominant color
palette as swatches with copyable values (hex, RGB, HSL) and a "copy all"
export (CSS variables, Tailwind snippet, JSON). Full spec in
`PALETTE_EXTRACTOR_SPEC.md` — read it before making changes.

## Stack (fixed — do not change without asking Sam)

- React 18 + Vite + Tailwind CSS
- From-scratch median-cut quantizer in `src/lib/medianCut.ts` (stretch goal;
  replaced the `quantize` library — zero runtime dependencies beyond React)
- Deployed to Cloudflare Pages as a static site from the GitHub repo
- No backend, no database, no API keys, no server cost. Everything runs in
  the browser.

## Commands

- `npm run dev` — local dev server
- `npm run build` — production build (output in `dist/`)
- `npm run preview` — preview the production build

## Key constraints

- Keep it small; do not over-engineer. No state libraries, no routing.
- The interface stays neutral and quiet — the extracted colors are the
  content. Swatch labels must switch between dark/light text based on the
  swatch's luminance so they stay readable.
- A built-in sample image must produce a full palette on first load with no
  user action.
- Must work well on a phone, including upload.
- Copy actions give visible confirmation on the specific control used.

## Acceptance criteria (check before calling anything done)

See section 8 of `PALETTE_EXTRACTOR_SPEC.md`. Short version: sample palette
on load, upload replaces palette, every value copies with confirmation,
"copy all" output is valid and paste-ready in all three formats, labels
readable on light and dark swatches, works on mobile.
