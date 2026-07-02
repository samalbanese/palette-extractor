import { useEffect, useRef, useState } from 'react'
import {
  type RGB,
  rgbToHex,
  rgbToHsl,
  formatRgb,
  formatHsl,
  labelColorFor,
} from '../lib/color'
import { copyText } from '../lib/clipboard'

interface SwatchProps {
  color: RGB
  index: number
}

type ValueKind = 'hex' | 'rgb' | 'hsl'

export function Swatch({ color, index }: SwatchProps) {
  const [copied, setCopied] = useState<ValueKind | null>(null)
  const timer = useRef<number>()

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const hex = rgbToHex(color)
  const values: Array<{ kind: ValueKind; text: string }> = [
    { kind: 'hex', text: hex },
    { kind: 'rgb', text: formatRgb(color) },
    { kind: 'hsl', text: formatHsl(rgbToHsl(color)) },
  ]
  const label = labelColorFor(color)

  const handleCopy = async (kind: ValueKind, text: string) => {
    const ok = await copyText(text)
    if (!ok) return
    setCopied(kind)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 1400)
  }

  return (
    <div
      className="group relative flex min-h-28 flex-col justify-end p-4 transition-[flex-grow] duration-300 ease-out sm:min-h-0 sm:grow sm:p-5 sm:hover:grow-[1.5] sm:focus-within:grow-[1.5]"
      style={{
        backgroundColor: hex,
        color: label,
        animation: 'swatch-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        animationDelay: `${index * 45}ms`,
        flexGrow: 1,
      }}
    >
      {values.map(({ kind, text }) => (
        <button
          key={kind}
          type="button"
          onClick={() => handleCopy(kind, text)}
          aria-label={`Copy ${text}`}
          className={`-mx-2 block w-fit max-w-full truncate rounded px-2 py-0.5 text-left font-mono transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
            kind === 'hex'
              ? 'text-sm font-medium sm:text-base'
              : 'text-xs opacity-85 hover:opacity-100 focus-visible:opacity-100 sm:text-[13px]'
          }`}
          style={{ color: 'inherit' }}
        >
          <span aria-live="polite">{copied === kind ? 'copied ✓' : text}</span>
        </button>
      ))}
    </div>
  )
}
