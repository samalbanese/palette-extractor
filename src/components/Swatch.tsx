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
  locked: boolean
  onToggleLock: () => void
}

type ValueKind = 'hex' | 'rgb' | 'hsl'

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {locked ? (
        <path
          d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v4A1.5 1.5 0 0 1 11.5 14h-7A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z"
          fill="currentColor"
        />
      ) : (
        <path
          d="M11.5 7H6.5V5a1.5 1.5 0 0 1 2.95-.39l1.45-.4A3 3 0 0 0 5 5v2h-.5A1.5 1.5 0 0 0 3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 11.5 7Z"
          fill="currentColor"
        />
      )}
    </svg>
  )
}

export function Swatch({ color, index, locked, onToggleLock }: SwatchProps) {
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
      <button
        type="button"
        onClick={onToggleLock}
        aria-pressed={locked}
        aria-label={locked ? `Unlock ${hex}` : `Lock ${hex} and re-extract the rest`}
        title={locked ? 'Unlock this color' : 'Keep this color when re-extracting'}
        className={`absolute right-3 top-3 grid size-8 place-items-center rounded-full transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
          locked
            ? 'opacity-100'
            : 'opacity-40 hover:opacity-100 focus-visible:opacity-100'
        }`}
        style={{
          color: 'inherit',
          backgroundColor: locked ? 'color-mix(in srgb, currentColor 16%, transparent)' : 'transparent',
        }}
      >
        <LockIcon locked={locked} />
      </button>

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
