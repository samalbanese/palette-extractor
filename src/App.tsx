import { useCallback, useEffect, useRef, useState } from 'react'
import sampleSrc from './assets/sample.svg'
import { Swatch } from './components/Swatch'
import { Controls } from './components/Controls'
import { type RGB, type SortMode, sortPalette } from './lib/color'
import { extractPalette } from './lib/extract'
import { type ExportFormat, exportPalette } from './lib/exporters'
import { copyText } from './lib/clipboard'

interface LoadedImage {
  src: string
  name: string
}

export default function App() {
  const [image, setImage] = useState<LoadedImage>({
    src: sampleSrc,
    name: 'Sample image',
  })
  const [palette, setPalette] = useState<RGB[]>([])
  const [count, setCount] = useState(6)
  const [sort, setSort] = useState<SortMode>('original')
  const [format, setFormat] = useState<ExportFormat>('css')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)
  const objectUrl = useRef<string | null>(null)
  const dragDepth = useRef(0)
  const requestId = useRef(0)

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

  // Extract whenever the image or requested color count changes.
  useEffect(() => {
    const id = ++requestId.current
    setExtracting(true)
    extractPalette(image.src, count)
      .then((colors) => {
        if (requestId.current !== id) return
        setPalette(colors)
        setError(null)
      })
      .catch((err: Error) => {
        if (requestId.current !== id) return
        setError(err.message)
      })
      .finally(() => {
        if (requestId.current === id) setExtracting(false)
      })
  }, [image.src, count])

  // Whole-window drag-and-drop and clipboard paste.
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
      if (item) loadFile(item.getAsFile())
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
  }, [loadFile])

  const sorted = sortPalette(palette, sort)
  // Remount swatches when the palette itself changes so the rise animation replays.
  const paletteKey = `${image.src}-${count}-${sort}`

  const handleCopyAll = () => copyText(exportPalette(sorted, format))

  return (
    <div className="flex min-h-dvh flex-col bg-paper font-sans text-ink">
      <header className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 px-5 pb-5 pt-6 sm:px-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Palette Extractor</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            Drop, paste, or upload an image — its colors appear below.
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
          {sorted.map((color, i) => (
            <Swatch key={i} color={color} index={i} />
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
          />
        </div>
      </main>

      <footer className="px-5 pb-5 sm:px-10">
        <p className="text-xs text-ink-soft">
          Runs entirely in your browser — images never leave your device.
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
