# Project Specification: Palette Extractor

## For the implementer

This document specifies a small web application to build. Read it in full,
produce a short `CLAUDE.md`, and confirm a plan with the user before building.
This is intentionally a small, client-side-only tool. Do not over-engineer it.
There is no backend, no external API, no database, and no server cost.

The user is not a programmer. Favor clear structure and readable code, and
decide implementation details rather than asking about them.

## 1. Summary

Upload an image, get its color palette. The tool extracts the dominant colors
and presents them as swatches with copyable values in the formats a designer or
developer actually uses: hex, RGB, HSL, a CSS custom-properties block, a
Tailwind color snippet, and JSON.

## 2. Required tech stack (fixed)

Fixed for consistency across the user's portfolio; do not change without
explaining the reason to the user first:

- React 18 with Vite and Tailwind CSS.
- Cloudflare Pages, deployed as a static site from a GitHub repository link.
  There is no backend and no Railway service here: everything runs in the
  browser, so there are no secret keys and no server cost.
- A small, well-established color-quantization library (for example ColorThief)
  for extraction, unless implementing quantization by hand as a stretch goal.

## 3. Scope for version 1

1. Drag-and-drop or click-to-upload an image. Accept clipboard paste if
   straightforward.
2. Extract a palette of dominant colors. Default to 6, with a control to choose
   roughly 4 to 10.
3. Display each color as a swatch showing hex, RGB, and HSL.
4. Copy any single value with one click, with visible confirmation.
5. A "copy all" action in a chosen export format: CSS variables, a Tailwind
   snippet, or JSON.
6. A built-in sample image so a full palette appears on load with no user
   action.

## 4. How extraction works

Color quantization is a solved problem; do not reinvent it for version 1. Draw
the uploaded image to an offscreen canvas, downscale it for performance (there
is no need to process a full-resolution photo pixel by pixel), run a
median-cut or similar quantizer to get the dominant colors, then convert the
resulting RGB values into hex and HSL for display.

Using an established library such as ColorThief is the recommended path for
version 1. Implementing median-cut or k-means quantization by hand is a valid
stretch goal but is not required.

## 5. Design direction

The extracted colors are the content, so the interface should nearly disappear
and let the swatches be the focus. Read and follow the frontend-design skill
available in this environment. Guardrails:

- A neutral, quiet interface so the colors are not competing with the interface.
  Avoid the three looks that read as AI-generated: cream with a serif and a
  terracotta accent; near-black with an acid-green accent; a hairline-rule
  broadsheet layout.
- Large, generous swatches. Each swatch's text stays readable regardless of the
  swatch color behind it, by switching the label between dark and light based on
  the swatch's luminance. This small detail signals care.
- Copy interactions give immediate, clear feedback on the specific control that
  was used.
- A clean drop zone that clearly invites an image and handles the sample image
  gracefully.

## 6. Build sequence

1. Scaffold the Vite, React, and Tailwind project. Produce `CLAUDE.md`.
2. Build the upload and drop zone, rendering the uploaded image and the built-in
   sample.
3. Wire up extraction: image to canvas, downscale, quantize, produce a color
   array.
4. Build the swatch display with hex, RGB, and HSL, and the luminance-aware
   labels.
5. Add single-value copy, then the "copy all" export in the three formats.
6. Add the color-count control.
7. Polish: responsive layout, keyboard access, drag-over visual feedback.

## 7. Out of scope for version 1 (stretch goals)

- A from-scratch quantization algorithm instead of the library.
- An accessibility helper showing which extracted colors form WCAG-compliant
  text and background pairs, with contrast ratios.
- Sorting the palette by hue or luminance.
- Extracting from a pasted image URL.
- Locking one color and re-extracting the rest around it.

## 8. Acceptance criteria

- On load, the sample image shows a full palette with no user action.
- Uploading a new image replaces the palette correctly.
- Every value copies to the clipboard with visible confirmation.
- "Copy all" produces valid, paste-ready CSS, Tailwind, and JSON.
- Swatch labels stay readable on both light and dark extracted colors.
- The tool works on a phone, including the upload interaction.
