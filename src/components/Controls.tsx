import { useEffect, useRef, useState } from 'react'
import type { SortMode } from '../lib/color'
import { type ExportFormat, EXPORT_LABELS } from '../lib/exporters'

interface ControlsProps {
  count: number
  onCountChange: (count: number) => void
  sort: SortMode
  onSortChange: (sort: SortMode) => void
  format: ExportFormat
  onFormatChange: (format: ExportFormat) => void
  onCopyAll: () => Promise<boolean>
  onShare: () => Promise<boolean>
  onSaveCard: () => Promise<void>
  showContrast: boolean
  onToggleContrast: () => void
  showHowItWorks: boolean
  onToggleHowItWorks: () => void
}

const MIN_COLORS = 4
const MAX_COLORS = 10

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'original', label: 'As found' },
  { value: 'hue', label: 'By hue' },
  { value: 'luminance', label: 'By light' },
]

const stepperButton =
  'grid size-8 place-items-center rounded-full text-lg leading-none text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-30 disabled:hover:bg-transparent'

export function Controls({
  count,
  onCountChange,
  sort,
  onSortChange,
  format,
  onFormatChange,
  onCopyAll,
  onShare,
  onSaveCard,
  showContrast,
  onToggleContrast,
  showHowItWorks,
  onToggleHowItWorks,
}: ControlsProps) {
  const [copiedAll, setCopiedAll] = useState(false)
  const [shared, setShared] = useState(false)
  const [saved, setSaved] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  const briefly = (setter: (value: boolean) => void) => {
    setter(true)
    timers.current.push(window.setTimeout(() => setter(false), 1600))
  }

  const handleCopyAll = async () => {
    if (await onCopyAll()) {
      briefly(setCopiedAll)
    }
  }

  const handleShare = async () => {
    if (await onShare()) briefly(setShared)
  }

  const handleSaveCard = async () => {
    try {
      await onSaveCard()
      briefly(setSaved)
    } catch {
      // The app reports rendering errors in its existing alert area.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="flex items-center gap-2" role="group" aria-label="Number of colors">
        <span className="text-sm text-ink-soft">Colors</span>
        <button
          type="button"
          className={stepperButton}
          onClick={() => onCountChange(count - 1)}
          disabled={count <= MIN_COLORS}
          aria-label="Fewer colors"
        >
          &minus;
        </button>
        <span className="w-5 text-center font-mono text-sm font-medium" aria-live="polite">
          {count}
        </span>
        <button
          type="button"
          className={stepperButton}
          onClick={() => onCountChange(count + 1)}
          disabled={count >= MAX_COLORS}
          aria-label="More colors"
        >
          +
        </button>
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Sort palette">
        {SORT_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSortChange(value)}
            aria-pressed={sort === value}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
              sort === value
                ? 'bg-ink text-paper'
                : 'text-ink-soft hover:bg-well hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleContrast}
        aria-pressed={showContrast}
        aria-expanded={showContrast}
        className={`rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
          showContrast
            ? 'bg-ink text-paper'
            : 'text-ink-soft hover:bg-well hover:text-ink'
        }`}
      >
        Readable pairs
      </button>

      <button
        type="button"
        onClick={onToggleHowItWorks}
        aria-pressed={showHowItWorks}
        aria-expanded={showHowItWorks}
        className={`rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
          showHowItWorks
            ? 'bg-ink text-paper'
            : 'text-ink-soft hover:bg-well hover:text-ink'
        }`}
      >
        How it works
      </button>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Export as
          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
            className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {(Object.keys(EXPORT_LABELS) as ExportFormat[]).map((value) => (
              <option key={value} value={value}>
                {EXPORT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleCopyAll}
          className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-95"
        >
          <span aria-live="polite">{copiedAll ? 'Copied ✓' : 'Copy all'}</span>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleShare}
          className="rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span aria-live="polite">{shared ? 'Link copied ✓' : 'Share'}</span>
        </button>
        <button
          type="button"
          onClick={handleSaveCard}
          className="rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span aria-live="polite">{saved ? 'Saved ✓' : 'Save PNG'}</span>
        </button>
      </div>
    </div>
  )
}
