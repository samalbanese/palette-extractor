import { useEffect, useRef, useState } from 'react'
import { type RGB, rgbToHex } from '../lib/color'
import { readablePairs } from '../lib/contrast'
import { copyText } from '../lib/clipboard'

interface ContrastPanelProps {
  palette: RGB[]
}

/**
 * Shows which extracted colors work together as text on background per WCAG,
 * strongest pairing first. Clicking a pair copies it as ready-to-paste CSS.
 */
export function ContrastPanel({ palette }: ContrastPanelProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const timer = useRef<number>()

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const pairs = readablePairs(palette)

  const handleCopy = async (index: number, fg: string, bg: string) => {
    const ok = await copyText(`color: ${fg};\nbackground-color: ${bg};`)
    if (!ok) return
    setCopiedIndex(index)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopiedIndex(null), 1400)
  }

  return (
    <section aria-label="Readable color pairs" className="px-5 pb-2 sm:px-10">
      <h2 className="text-sm font-medium">Readable pairs</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Palette colors that meet WCAG contrast for text — AAA is 7:1+, AA is
        4.5:1+, AA&nbsp;Large is 3:1+ (headlines only). Click a pair to copy it
        as CSS.
      </p>

      {pairs.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          No two colors in this palette are far enough apart for readable text.
          Try more colors, or an image with lights and darks.
        </p>
      ) : (
        <ul className="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {pairs.map((pair, i) => {
            const fg = rgbToHex(pair.fg)
            const bg = rgbToHex(pair.bg)
            return (
              <li key={`${fg}-${bg}`}>
                <button
                  type="button"
                  onClick={() => handleCopy(i, fg, bg)}
                  aria-label={`Copy CSS for ${fg} text on ${bg}, contrast ${pair.ratio.toFixed(2)} to 1, ${pair.level}`}
                  className="w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <span
                    className="grid h-16 place-items-center rounded-lg border border-line text-xl font-semibold"
                    style={{ backgroundColor: bg, color: fg }}
                  >
                    Aa
                  </span>
                  <span className="mt-1.5 flex items-baseline justify-between gap-2 px-0.5">
                    <span className="truncate font-mono text-xs text-ink-soft" aria-live="polite">
                      {copiedIndex === i ? 'copied ✓' : `${fg} on ${bg}`}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-ink-soft">
                      {pair.ratio.toFixed(1)}
                      <span className="ml-1.5 rounded-full border border-line px-1.5 py-px text-[10px] tracking-wide text-ink">
                        {pair.level}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
