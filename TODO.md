# TODO

## Now

- [ ] [MANUAL] Connect Cloudflare Pages to the `samalbanese/palette-extractor`
      GitHub repo (build command `npm run build`, output directory `dist`,
      no environment variables). Steps are in README.md → Deploy.
- [ ] After first deploy: open the live URL on a phone and confirm upload +
      copy work (final acceptance criterion).

## Later (stretch goals from the spec, section 7)

- [ ] WCAG contrast helper: show which extracted colors pair safely as
      text/background, with contrast ratios.
- [ ] Extract from a pasted image URL.
- [ ] Lock one color and re-extract the rest around it.
- [ ] From-scratch quantizer (median-cut or k-means) to replace the library.

## Done

- [x] 2026-07-02 — v1 built, tested (15 unit + 19 e2e checks), pushed.
- [x] 2026-07-02 — Stretch: palette sorting (as found / by hue / by light).
