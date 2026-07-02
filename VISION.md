# VISION — Palette Extractor

## What is this?

A little tool for my portfolio: drop in any image and instantly get its
color palette. Designers and developers can grab the colors in whatever
format they actually work in — hex, RGB, HSL, CSS variables, a Tailwind
snippet, or JSON — with one click each.

## What does success look like?

- I open the page and a palette is already there from a sample image —
  the tool demonstrates itself with zero effort.
- I drop in a photo and get a palette that genuinely looks like the photo.
- Every copy button just works, tells me it worked, and the pasted value is
  valid wherever I paste it.
- It feels effortless on my phone too.
- The interface gets out of the way — the colors are the star.

## What is this NOT?

- Not a design suite. No palette editing, no saving, no accounts.
- No backend, no costs, no keys. It's a static page.
- Version 1 doesn't need: WCAG contrast pairing, hue sorting, URL
  extraction, or color locking. Those are stretch goals for later.

## Current priority

Ship version 1 per `PALETTE_EXTRACTOR_SPEC.md`, deployed on Cloudflare
Pages from this repo.
