import { useEffect, useRef, useState } from 'react'
import { rgbToHex } from '../lib/color'
import type { Pixel, SplitStep, WeightedColor } from '../lib/medianCut'

interface PixelSpaceProps {
  pixels: Pixel[]
  steps: SplitStep[]
  palette: WeightedColor[]
}

interface Point2D {
  x: number
  y: number
}

const BOX_EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 4],
  [1, 3], [1, 5],
  [2, 3], [2, 6],
  [3, 7],
  [4, 5], [4, 6],
  [5, 7],
  [6, 7],
]

export function PixelSpace({ pixels, steps, palette }: PixelSpaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [replay, setReplay] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let lastFrame = 0
    let lastStep = 0
    let stepIndex = reducedMotion ? Math.max(0, steps.length - 1) : 0
    const startedAt = performance.now()

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(bounds.width * dpr))
      canvas.height = Math.max(1, Math.round(bounds.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(performance.now())
    }

    const project = (
      point: Pixel,
      angle: number,
      width: number,
      height: number
    ): Point2D => {
      const x = point[0] - 127.5
      const y = point[1] - 127.5
      const z = point[2] - 127.5
      const cosY = Math.cos(angle)
      const sinY = Math.sin(angle)
      const rotatedX = x * cosY + z * sinY
      const rotatedZ = -x * sinY + z * cosY
      const tilt = Math.PI / 9
      const rotatedY = y * Math.cos(tilt) - rotatedZ * Math.sin(tilt)
      const scale = (Math.min(width, height) - 44) / 360
      return {
        x: width / 2 + rotatedX * scale,
        y: height / 2 - rotatedY * scale,
      }
    }

    const drawBox = (
      bounds: SplitStep[number]['bounds'],
      angle: number,
      width: number,
      height: number,
      stroke: string
    ) => {
      const { min, max } = bounds
      const corners: Pixel[] = [
        [min[0], min[1], min[2]], [max[0], min[1], min[2]],
        [min[0], max[1], min[2]], [max[0], max[1], min[2]],
        [min[0], min[1], max[2]], [max[0], min[1], max[2]],
        [min[0], max[1], max[2]], [max[0], max[1], max[2]],
      ]
      const projected = corners.map((corner) => project(corner, angle, width, height))
      ctx.beginPath()
      for (const [from, to] of BOX_EDGES) {
        ctx.moveTo(projected[from].x, projected[from].y)
        ctx.lineTo(projected[to].x, projected[to].y)
      }
      ctx.strokeStyle = stroke
      ctx.lineWidth = 1
      ctx.stroke()
    }

    const draw = (now: number) => {
      const bounds = canvas.getBoundingClientRect()
      const width = bounds.width
      const height = bounds.height
      const angle = reducedMotion
        ? Math.PI / 4
        : ((now - startedAt) / 12000) * Math.PI * 2
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#f7f5f0'
      ctx.fillRect(0, 0, width, height)

      // Faint frame of the full RGB cube grounds the rotation spatially.
      drawBox(
        { min: [0, 0, 0], max: [255, 255, 255] },
        angle,
        width,
        height,
        'oklch(0.26 0.012 80 / 0.1)'
      )

      ctx.globalAlpha = 0.65
      for (const pixel of pixels) {
        const point = project(pixel, angle, width, height)
        ctx.fillStyle = `rgb(${pixel[0]} ${pixel[1]} ${pixel[2]})`
        ctx.fillRect(point.x - 1.3, point.y - 1.3, 2.6, 2.6)
      }
      ctx.globalAlpha = 1

      const current = steps[stepIndex]
      if (current) {
        for (const box of current) {
          drawBox(box.bounds, angle, width, height, 'oklch(0.26 0.012 80 / 0.35)')
        }
      }

      const atFinal = steps.length === 0 || stepIndex === steps.length - 1
      if (atFinal) {
        const finals = current
          ?? palette.map((entry) => ({ color: entry.color, population: entry.population }))
        const total = finals.reduce((sum, entry) => sum + entry.population, 0)
        for (const { color, population } of finals) {
          // Dot size tracks how much of the image the color covers.
          const radius = 4.5 + Math.sqrt(total ? population / total : 0) * 7
          const point = project([color.r, color.g, color.b], angle, width, height)
          ctx.beginPath()
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
          ctx.fillStyle = rgbToHex(color)
          ctx.fill()
          ctx.strokeStyle = '#f7f5f0'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
    }

    const tick = (now: number) => {
      if (document.visibilityState !== 'visible') return
      if (!reducedMotion && steps.length > 1 && stepIndex < steps.length - 1) {
        if (!lastStep) lastStep = now
        if (now - lastStep >= 700) {
          stepIndex += 1
          lastStep = now
        }
      }
      if (now - lastFrame >= 1000 / 30) {
        draw(now)
        lastFrame = now
      }
      if (!reducedMotion) frame = requestAnimationFrame(tick)
    }

    const start = () => {
      cancelAnimationFrame(frame)
      if (document.visibilityState === 'visible') {
        if (reducedMotion) draw(performance.now())
        else frame = requestAnimationFrame(tick)
      }
    }
    const onVisibility = () => start()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)
    resize()
    start()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [palette, pixels, reducedMotion, replay, steps])

  return (
    <section aria-labelledby="pixel-space-heading" className="px-5 pb-4 sm:px-10">
      <h2 id="pixel-space-heading" className="text-sm font-medium">How it works</h2>
      <p className="mt-0.5 max-w-5xl text-sm text-ink-soft">
        Every pixel of your image, plotted in RGB color space. Median cut
        repeatedly splits the most important box at the median of its widest
        channel — each final box&apos;s average becomes a swatch.
      </p>
      {pixels.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          Every color is locked, so nothing was extracted. Unlock a color or
          load a new image to watch the algorithm work.
        </p>
      ) : (
        <canvas
          ref={canvasRef}
          aria-label="Image pixels rotating in an RGB color cube while median-cut boxes split into the final palette"
          className="mt-4 h-[300px] w-full max-w-xl rounded-xl border border-line bg-paper sm:h-[380px]"
        />
      )}
      {!reducedMotion && pixels.length > 0 && (
        <button
          type="button"
          onClick={() => setReplay((value) => value + 1)}
          className="mt-2 rounded-full px-2 py-1 text-sm text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Replay
        </button>
      )}
    </section>
  )
}
