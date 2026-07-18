import { useCallback, useEffect, useRef, useState } from 'react'
import sampleSrc from './assets/sample.svg'
import { Swatch } from './components/Swatch'
import { Controls } from './components/Controls'
import { ContrastPanel } from './components/ContrastPanel'
import { PixelSpace } from './components/PixelSpace'
import { type RGB, type SortMode, rgbToHex, sortPalette } from './lib/color'
import {
  extractPaletteDetailed,
  resolveImageUrl,
  type ExtractionDetail,
} from './lib/extract'
import { type ExportFormat, exportPalette } from './lib/exporters'
import { copyText } from './lib/clipboard'
import type { Pixel, SplitStep, WeightedColor } from './lib/medianCut'
import { nearestColorName } from './lib/names'
import { decodePaletteHash, encodePaletteHash } from './lib/share'
import { downloadBlob, renderPaletteCard } from './lib/paletteCard'
import { updatePaletteFavicon } from './lib/favicon'

interface LoadedImage {
  src: string
  name: string
}

function nameFromUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url)
    const tail = pathname.split('/').filter(Boolean).pop()
    return tail ? `${hostname}/${tail}` : hostname
  } catch {
    return url
  }
}

export default function App() {
  const [sharedPalette] = useState(() => decodePaletteHash(location.hash))
  const [image, setImage] = useState<LoadedImage>({
    src: sampleSrc,
    name: 'Sample image',
  })
  const [palette, setPalette] = useState<WeightedColor[]>([])
  const [pixels, setPixels] = useState<Pixel[]>([])
  const [steps, setSteps] = useState<SplitStep[]>([])
  const [locked, setLocked] = useState<RGB[]>(() => sharedPalette ?? [])
  const [count, setCount] = useState(() =>
    sharedPalette ? Math.min(10, Math.max(4, sharedPalette.length)) : 6
  )
  const [sort, setSort] = useState<SortMode>('original')
  const [format, setFormat] = useState<ExportFormat>('css')
  const [showContrast, setShowContrast] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)
  const objectUrl = useRef<string | null>(null)
  const dragDepth = useRef(0)
  const requestId = useRef(0)

  useEffect(() => {
    if (!sharedPalette) return
    history.replaceState(null, '', location.pathname + location.search)
  }, [sharedPalette])

  const loadFile = useCallback((file: File | undefined | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image. Try a JPG, PNG, WebP, or SVG.')
      return
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = URL.createObjectURL(file)
    setError(null)
    setImage({ src: objectUrl.current, name: file.name })
  }, [])

  const loadUrl = useCallback(async (url: string) => {
    setError(null)
    setExtracting(true)
    try {
      const src = await resolveImageUrl(url)
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current)
        objectUrl.current = null
      }
      setImage({ src, name: nameFromUrl(url) })
    } catch (err) {
      setExtracting(false)
      setError((err as Error).message)
    }
  }, [])

  // Extract whenever the image, requested count, or locked colors change.
  // Locked colors stay; the rest re-extracts around them.
  const lockedKey = locked.map(rgbToHex).join(',')
  useEffect(() => {
    const id = ++requestId.current
    setExtracting(true)
    const remaining = count - locked.length
    const run = async (): Promise<ExtractionDetail> => {
      if (remaining <= 0) {
        return {
          colors: locked.slice(0, count).map((color) => ({ color, population: 1 })),
          pixels: [],
          steps: [],
        }
      }
      const detail = await extractPaletteDetailed(image.src, remaining, locked)
      const meanPopulation = detail.colors.length
        ? detail.colors.reduce((sum, entry) => sum + entry.population, 0)
          / detail.colors.length
        : 1
      return {
        ...detail,
        colors: [
          ...locked.map((color) => ({ color, population: meanPopulation })),
          ...detail.colors,
        ],
      }
    }
    run()
      .then((detail) => {
        if (requestId.current !== id) return
        setPalette(detail.colors)
        setPixels(detail.pixels)
        setSteps(detail.steps)
        setError(null)
      })
      .catch((err: Error) => {
        if (requestId.current !== id) return
        setError(err.message)
      })
      .finally(() => {
        if (requestId.current === id) setExtracting(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.src, count, lockedKey])

  // Whole-window drag-and-drop, plus paste (image data or an image URL).
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragDepth.current += 1
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      loadFile(e.dataTransfer?.files[0])
    }
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/')
      )
      if (item) {
        loadFile(item.getAsFile())
        return
      }
      const text = e.clipboardData?.getData('text/plain').trim()
      if (text && /^https?:\/\/\S+$/i.test(text)) void loadUrl(text)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [loadFile, loadUrl])

  const lockedSet = new Set(locked.map(rgbToHex))
  const toggleLock = (color: RGB) => {
    const hex = rgbToHex(color)
    setLocked((prev) =>
      prev.some((c) => rgbToHex(c) === hex)
        ? prev.filter((c) => rgbToHex(c) !== hex)
        : [...prev, color]
    )
  }

  const sorted = sortPalette(palette, sort)
  const sortedColors = sorted.map((entry) => entry.color)
  const totalPopulation = sorted.reduce((sum, entry) => sum + entry.population, 0)
  // Remount swatches when the palette itself changes so the rise animation replays.
  const paletteKey = `${image.src}-${count}-${sort}-${lockedKey}`

  const handleCopyAll = () => copyText(exportPalette(sortedColors, format))
  const handleShare = () =>
    copyText(
      location.origin
        + location.pathname
        + encodePaletteHash(sortedColors)
    )
  const handleSaveCard = async () => {
    try {
      if (sortedColors.length === 0) {
        throw new Error('Wait for the palette to finish extracting.')
      }
      const blob = await renderPaletteCard(
        sortedColors.map((color) => ({
          color,
          name: nearestColorName(color),
        })),
        image.name
      )
      const firstHex = rgbToHex(sortedColors[0]).slice(1)
      downloadBlob(blob, `palette-${firstHex}.png`)
    } catch (err) {
      setError((err as Error).message)
      throw err
    }
  }

  const faviconKey = sortedColors.map(rgbToHex).join(',')
  useEffect(() => {
    updatePaletteFavicon(sortedColors)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faviconKey])

  return (
    <div className="flex min-h-dvh flex-col bg-paper font-sans text-ink">
      <header className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 px-5 pb-5 pt-6 sm:px-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Palette Extractor</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            Drop, paste, or upload an image — or paste an image URL.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="group flex items-center gap-3 rounded-xl border border-dashed border-line bg-well/60 py-2 pl-2 pr-4 text-left transition-colors hover:border-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <img
            src={image.src}
            alt=""
            crossOrigin={/^https?:/i.test(image.src) ? 'anonymous' : undefined}
            className="h-12 w-16 rounded-lg object-cover"
          />
          <span>
            <span className="block text-sm font-medium">
              {image.name === 'Sample image' ? 'Choose an image' : 'Replace image'}
            </span>
            <span className="block max-w-52 truncate text-xs text-ink-soft">
              {image.name}
            </span>
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            loadFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </header>

      {error && (
        <p role="alert" className="px-5 pb-3 text-sm text-red-700 sm:px-10">
          {error}
        </p>
      )}

      <main className="flex flex-1 flex-col">
        <div
          className={`flex min-h-[420px] flex-1 flex-col transition-opacity duration-200 sm:min-h-[52vh] sm:flex-row ${
            extracting ? 'opacity-60' : 'opacity-100'
          }`}
          key={paletteKey}
        >
          {sorted.map((entry, i) => (
            <Swatch
              key={`${rgbToHex(entry.color)}-${i}`}
              color={entry.color}
              index={i}
              locked={lockedSet.has(rgbToHex(entry.color))}
              weight={totalPopulation ? entry.population / totalPopulation : 0}
              name={nearestColorName(entry.color)}
              onToggleLock={() => toggleLock(entry.color)}
            />
          ))}
        </div>

        <div className="px-5 py-5 sm:px-10">
          <Controls
            count={count}
            onCountChange={setCount}
            sort={sort}
            onSortChange={setSort}
            format={format}
            onFormatChange={setFormat}
            onCopyAll={handleCopyAll}
            onShare={handleShare}
            onSaveCard={handleSaveCard}
            showContrast={showContrast}
            onToggleContrast={() => setShowContrast((v) => !v)}
            showHowItWorks={showHowItWorks}
            onToggleHowItWorks={() => setShowHowItWorks((v) => !v)}
          />
        </div>

        {showHowItWorks && (
          <PixelSpace pixels={pixels} steps={steps} palette={sorted} />
        )}
        {showContrast && <ContrastPanel palette={sortedColors} />}
      </main>

      <footer className="px-5 pb-5 pt-2 sm:px-10">
        <p className="text-xs text-ink-soft">
          Uploads stay in your browser and never leave your device. Pasted URLs
          are fetched from the web, through the images.weserv.nl proxy when the
          site blocks direct access.
        </p>
      </footer>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-10 grid place-items-center bg-ink/85">
          <p className="text-lg font-medium text-paper">Drop your image anywhere</p>
        </div>
      )}
    </div>
  )
}
