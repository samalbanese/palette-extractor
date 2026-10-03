import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import sunset from "./assets/sample.svg";
import { type ValueKind } from "./components/Swatch";
import { SwatchGrid, usePresentation } from "./components/SwatchGrid";
import { ThemePreview } from "./components/ThemePreview";
import { Atmosphere } from "./components/Atmosphere";
import { Icon } from "./components/Icon";
import {
  type RGB,
  type SortMode,
  rgbToHex,
  rgbToHsl,
  formatRgb,
  formatHsl,
} from "./lib/color";
import { type ExportFormat, exportPalette } from "./lib/exporters";
import { nearestColorName } from "./lib/names";
import { encodePaletteHash } from "./lib/share";
import { downloadBlob, renderPaletteCard } from "./lib/paletteCard";
import { useImageSource, type Source } from "./hooks/useImageSource";
import { usePalette } from "./hooks/usePalette";
import { useColorSpaceComparison } from "./hooks/useColorSpaceComparison";
import { useCopyFeedback } from "./hooks/useCopyFeedback";
import { useSharedPalette } from "./hooks/useSharedPalette";
import type { StageResult } from "./components/Stage";

const loadStage = () => import("./components/Stage");
const Stage = lazy(loadStage);

// Resolves once the browser reports the photo as the page's largest paint, so
// the stage download does not compete with it. Browsers that do not report
// largest paints skip the wait. The photo may also never get an entry (another
// element is larger, or early input stops the reporting), so a short timeout
// bounds the wait.
const afterLargestPaint = (image: HTMLImageElement) =>
  new Promise<void>((resolve) => {
    if (
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes?.includes(
        "largest-contentful-paint",
      )
    ) {
      resolve();
      return;
    }
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if ((entry as LargestContentfulPaint).element === image) finish();
    });
    const timer = setTimeout(() => finish(), 600);
    function finish() {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    }
    try {
      observer.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      finish();
    }
  });

// "In context" is the default tab. The other tool panels stay off screen
// until picked, so their code loads in separate chunks.
const ContrastPanel = lazy(() =>
  import("./components/ContrastPanel").then((m) => ({
    default: m.ContrastPanel,
  })),
);
const PixelSpace = lazy(() =>
  import("./components/PixelSpace").then((m) => ({ default: m.PixelSpace })),
);
const ExportPanel = lazy(() =>
  import("./components/ExportPanel").then((m) => ({
    default: m.ExportPanel,
  })),
);

const samples: Source[] = [
  {
    src: "/samples/namib.webp",
    name: "Golden dunes",
    credit: "Andrew Svk",
    creditUrl: "https://unsplash.com/photos/0s9oD70F-l4",
  },
  {
    src: "/samples/fern.webp",
    name: "Forest floor",
    credit: "Domenico Gentile",
    creditUrl: "https://unsplash.com/photos/N7Q0Ir-hXeA",
  },
  {
    src: sunset,
    name: "Coastal color",
    credit: "Palette Extractor",
    creditUrl: "https://github.com/relaywright/palette-extractor",
  },
];
const tabs = [
  { id: "context", label: "In context", icon: "image" },
  { id: "contrast", label: "Contrast check", icon: "contrast" },
  { id: "algorithm", label: "How it works", icon: "cube" },
  { id: "export", label: "Export palette", icon: "code" },
] as const;
type Tab = (typeof tabs)[number]["id"];

// On phones the upload button, sample moods and drop/URL row render below the
// palette instead, so the stage and every swatch fit the first screen.
const PHONE = "(max-width: 580px)";

// Sizes the dock's hidden inspector row before the first palette; a mid-length
// color so its values take about as much room as a real one.
const PLACEHOLDER_COLOR: RGB = { r: 95, g: 146, b: 173 };

export default function App() {
  // Read during the first render so the controls never paint in the wrong
  // place, then kept current as the window crosses the breakpoint.
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const media = matchMedia(PHONE);
    const update = () => setPhone(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const [valueKind, setValueKind] = useState<ValueKind>("hex");
  const [format, setFormat] = useState<ExportFormat>("css");
  const [activeTab, setActiveTab] = useState<Tab>("context");
  // A selection lasts while its swatch does, until the next new photo.
  const [selection, setSelection] = useState<{
    id: string;
    photo: number;
  } | null>(null);

  const shared = useSharedPalette((colors) => {
    imageSource.resetForShared();
    palette.loadShared(colors);
  });

  const imageSource = useImageSource({
    initialSource: shared ? null : samples[0],
    onSourceChosen: () => palette.bumpMinCount(),
  });

  const copyFeedback = useCopyFeedback({ setError: imageSource.setError });

  const palette = usePalette({
    source: imageSource.source,
    urlBusy: imageSource.urlBusy,
    initialColors: shared,
    setLoaded: imageSource.setLoaded,
    setError: imageSource.setError,
    setNotice: copyFeedback.setNotice,
  });

  const { source, loaded, error, dragging, urlBusy, showUrl, url, fileInput } =
    imageSource;
  const {
    sorted,
    colors,
    total,
    lockedSet,
    count,
    locked,
    sort,
    busy,
    colorSpace,
    changedHexes,
  } = palette;
  const comparison = useColorSpaceComparison(
    sorted,
    palette.detailColorSpace,
    loaded,
    changedHexes,
  );
  const { copied, notice } = copyFeedback;
  const hero = useRef<HTMLImageElement>(null);
  const stageHost = useRef<HTMLDivElement>(null);
  const [stageReady, setStageReady] = useState(false);
  const heroSrc = (loaded ?? source)?.src;
  useEffect(() => {
    const image = hero.current;
    if (!image || stageReady) return;
    let cancelled = false;
    let started = false;
    const open = async () => {
      if (started) return;
      started = true;
      try {
        await image.decode();
      } catch {
        return;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await afterLargestPaint(image);
      if (cancelled) return;
      await loadStage();
      await new Promise<void>((resolve) => {
        if ("requestIdleCallback" in window)
          window.requestIdleCallback(() => resolve(), { timeout: 300 });
        else setTimeout(resolve, 50);
      });
      if (!cancelled) setStageReady(true);
    };
    if (image.complete) void open();
    image.addEventListener("load", open);
    return () => {
      cancelled = true;
      image.removeEventListener("load", open);
    };
  }, [heroSrc, stageReady]);
  const stageResult = useMemo<StageResult | null>(
    () =>
      loaded && palette.detail.samples
        ? {
            image: loaded,
            samples: palette.detail.samples,
            steps: palette.detail.steps,
            colorSpace: palette.detailColorSpace,
            swatches: sorted.map((entry) => entry.color),
            populations: sorted.map((entry) => entry.population),
          }
        : null,
    [loaded, palette.detail, palette.detailColorSpace, sorted],
  );

  const presentation = usePresentation(sorted, loaded, lockedSet);
  // The inspector falls back to the first swatch; the swatches must agree.
  const selectedSwatch =
    (selection?.photo === presentation.photo &&
      presentation.swatches.find((swatch) => swatch.id === selection.id)) ||
    presentation.swatches[0];
  const selected = selectedSwatch?.color;
  // Before the first palette arrives the dock keeps its place with a hidden
  // stand-in color, so nothing below it moves when the palette lands.
  const inspected = selected ?? PLACEHOLDER_COLOR;
  const showWeights = !!loaded && locked.length === 0;

  const copy = (text: string, key: string) => void copyFeedback.copy(text, key);
  const saveCard = async () => {
    try {
      const blob = await renderPaletteCard(
        colors.map((color) => ({ color, name: nearestColorName(color) })),
        loaded?.name ?? "Shared palette",
      );
      downloadBlob(blob, `palette-${rgbToHex(colors[0]).slice(1)}.png`);
      copyFeedback.setNotice("Palette card downloaded.");
    } catch {
      imageSource.setError(
        "Could not save the palette card. Try downloading an SVG from Export palette.",
      );
    }
  };

  const uploadButton = (
    <button
      className="button primary upload-main"
      onClick={() => fileInput.current?.click()}
    >
      <Icon name="upload" /> Upload image <span className="shortcut">↗</span>
    </button>
  );
  const sourceControls = (
    <>
      <div className="sample-row">
        <span>Try a different mood</span>
        <div>
          {samples.map((sample) => (
            <button
              key={sample.src}
              className={source?.src === sample.src ? "active" : ""}
              aria-label={`Try ${sample.name}`}
              aria-pressed={source?.src === sample.src}
              onClick={() => imageSource.chooseSource(sample)}
            >
              <img src={sample.src} alt="" />
              <span>{sample.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="source-actions">
        <span>Drop an image anywhere or paste from clipboard</span>
        <button
          className="text-button"
          aria-expanded={showUrl}
          onClick={() => imageSource.setShowUrl((v) => !v)}
        >
          <Icon name="link" size={14} /> Use URL
        </button>
      </div>
      {showUrl && (
        <form
          className="url-form"
          onSubmit={(e) => {
            e.preventDefault();
            void imageSource.loadUrl(url);
          }}
        >
          <label htmlFor="image-url">Public image URL</label>
          <div>
            <input
              autoFocus
              id="image-url"
              type="url"
              required
              placeholder="https://example.com/image.jpg"
              value={url}
              onChange={(e) => imageSource.setUrl(e.target.value)}
            />
            <button className="button secondary" disabled={urlBusy}>
              {urlBusy ? "Loading…" : "Load"}
            </button>
          </div>
          <p>
            Remote images may be fetched through images.weserv.nl. Local uploads
            stay on your device.
          </p>
        </form>
      )}
    </>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to color workspace
      </a>
      <header className="site-header">
        <a
          className="wordmark"
          href={location.pathname}
          aria-label="Palette Extractor home"
        >
          <span className="logo-bars">
            {["#d9a872", "#b97667", "#7c8890", "#d3c8b3"].map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span>
            palette<span className="wordmark-light"> / extractor</span>
          </span>
        </a>
        <div className="header-right">
          <span className="local-badge">
            <i /> Local by design
          </span>
          <a
            href="https://github.com/relaywright/palette-extractor"
            target="_blank"
            rel="noreferrer"
          >
            View source <Icon name="arrow" size={14} />
          </a>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <h1>
              Color, pulled into focus<span>.</span>
            </h1>
            <p>Find the colors worth keeping. Make something with them.</p>
          </div>
          {!phone && uploadButton}
        </section>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          aria-label="Upload an image"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            imageSource.loadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && (
          <div role="alert" className="error-banner">
            <p>{error}</p>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => imageSource.setError(null)}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="workspace" id="workspace" aria-busy={busy}>
          <Atmosphere palette={palette.detail.colors} />
          <section className="source-panel" aria-labelledby="source-heading">
            <div className="section-label">
              <h2 id="source-heading">
                <span>01</span> The source
              </h2>
              <fieldset
                className="colorspace-switch"
                disabled={!source || busy}
              >
                <legend className="sr-only">Color space</legend>
                <span className="colorspace-options">
                  <label className={colorSpace === "rgb" ? "active" : ""}>
                    <input
                      type="radio"
                      name="color-space"
                      checked={colorSpace === "rgb"}
                      onChange={() => palette.setColorSpace("rgb")}
                    />
                    RGB
                  </label>
                  <label className={colorSpace === "oklab" ? "active" : ""}>
                    <input
                      type="radio"
                      name="color-space"
                      checked={colorSpace === "oklab"}
                      onChange={() => palette.setColorSpace("oklab")}
                    />
                    Perceptual
                  </label>
                </span>
              </fieldset>
              <button
                className="text-button"
                onClick={() => fileInput.current?.click()}
              >
                Replace <Icon name="arrow" size={14} />
              </button>
            </div>
            <div className={`source-frame ${busy ? "is-processing" : ""}`}>
              {loaded || source ? (
                <img
                  ref={hero}
                  src={(loaded ?? source)!.src}
                  alt={(loaded ?? source)!.name}
                  {...{ fetchpriority: "high" }}
                  decoding="async"
                  crossOrigin={
                    /^https?:/i.test((loaded ?? source)!.src)
                      ? "anonymous"
                      : undefined
                  }
                />
              ) : (
                <div className="shared-source">
                  <Icon name="link" size={30} />
                  <h3>A palette worth sharing.</h3>
                  <p>
                    This link includes the colors.
                    <br />
                    The original image stays private.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    Add your own image
                  </button>
                </div>
              )}
              <div
                ref={stageHost}
                className="stage-host"
                data-stage-mode={!source && !stageResult ? "none" : "pending"}
                data-stage-phase="waiting"
                data-stage-loop="idle"
                data-stage-points="0"
                data-stage-frames="0"
              >
                {stageReady && stageResult && (
                  <Suspense fallback={null}>
                    <Stage result={stageResult} host={stageHost} hero={hero} />
                  </Suspense>
                )}
              </div>
              {busy && (
                <span className="processing-badge">
                  <i /> Finding your colors…
                </span>
              )}
              <div className="image-caption">
                <span>
                  {loaded?.name ??
                    (shared && !source ? "Shared palette" : source?.name)}
                </span>
                <span>
                  {loaded?.credit ? (
                    <a href={loaded.creditUrl} target="_blank" rel="noreferrer">
                      Photo / {loaded.credit}
                    </a>
                  ) : loaded ? (
                    "On your device"
                  ) : (
                    ""
                  )}
                </span>
              </div>
            </div>
            {!phone && sourceControls}
          </section>
          <section className="palette-panel" aria-labelledby="palette-heading">
            <div className="section-label">
              <div className="palette-title">
                <h2 id="palette-heading">
                  <span>02</span> The palette <b>{colors.length}</b>
                </h2>
                <p className="color-comparison">
                  {comparison &&
                    `${comparison.changed} of ${comparison.total} colors changed`}
                </p>
              </div>
              <div
                className="value-switch"
                role="group"
                aria-label="Color value format"
              >
                {(["hex", "rgb", "hsl"] as const).map((kind) => (
                  <button
                    key={kind}
                    aria-pressed={valueKind === kind}
                    onClick={() => setValueKind(kind)}
                  >
                    {kind.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <fieldset
              className={`palette-fieldset ${busy ? "is-busy" : ""}`}
              disabled={busy}
            >
              <legend className="sr-only">Extracted colors</legend>
              <SwatchGrid
                presentation={presentation}
                valueKind={valueKind}
                total={total}
                showWeights={showWeights}
                lockedSet={lockedSet}
                canLock={!!source}
                changedHexes={changedHexes}
                copied={copied}
                onCopy={copy}
                onToggleLock={palette.toggleLock}
                selectedId={selectedSwatch?.id ?? null}
                onSelect={(id) =>
                  setSelection({ id, photo: presentation.photo })
                }
              />
            </fieldset>
            <div className="palette-toolbar">
              <div
                className="count-control"
                role="group"
                aria-label="Number of colors"
              >
                <span>Colors</span>
                <button
                  aria-label="Fewer colors"
                  onClick={() => palette.setCount((v) => v - 1)}
                  disabled={
                    !source || count <= Math.max(4, locked.length) || busy
                  }
                >
                  −
                </button>
                <output>{count}</output>
                <button
                  aria-label="More colors"
                  onClick={() => palette.setCount((v) => v + 1)}
                  disabled={!source || count >= 10 || busy}
                >
                  +
                </button>
              </div>
              <label className="sort-label">
                Sort
                <select
                  aria-label="Sort palette"
                  value={sort}
                  onChange={(e) => palette.setSort(e.target.value as SortMode)}
                >
                  <option value="original">By dominance</option>
                  <option value="hue">By hue</option>
                  <option value="luminance">By lightness</option>
                </select>
              </label>
              {locked.length > 0 && source && (
                <button
                  className="text-button"
                  onClick={() => palette.setLocked([])}
                  disabled={busy}
                >
                  Unlock all
                </button>
              )}
            </div>
            <div
              className="distribution"
              role="img"
              aria-label={
                showWeights ? "Relative color distribution" : "Palette colors"
              }
            >
              {sorted.map((e, i) => (
                <i
                  key={i}
                  style={{
                    background: rgbToHex(e.color),
                    flex: showWeights ? Math.max(e.population, 1) : 1,
                  }}
                />
              ))}
            </div>
            <p className="palette-hint">
              {/* Keyed to the chosen photo rather than the finished palette, so
                  the hint already reads right while the first one loads. */}
              {source && locked.length === 0
                ? "Bar widths show color-group share of the sampled image."
                : source
                  ? "Pinned colors stay with you. Distribution is hidden while colors are locked."
                  : "Shared colors are preserved. Add an image to explore further."}{" "}
              {colors.length > 0 &&
                colors.length < count &&
                "This image has fewer distinct colors than requested."}
            </p>
          </section>
        </div>
        {phone && (
          <div className="phone-source-controls">
            {uploadButton}
            {sourceControls}
          </div>
        )}
        <div className="palette-dock">
          <div
            className={`inspector ${selected ? "" : "is-pending"}`}
            aria-hidden={!selected || undefined}
          >
            <i style={{ background: rgbToHex(inspected) }} />
            <span>{nearestColorName(inspected)}</span>
            {[
              rgbToHex(inspected),
              formatRgb(inspected),
              formatHsl(rgbToHsl(inspected)),
            ].map((value) => (
              <button
                key={value}
                onClick={() => copy(value, `inspector ${value}`)}
                aria-label={`Copy ${value} from inspector`}
                disabled={!selected}
              >
                <code>
                  {copied === `inspector ${value}` ? "Copied!" : value}
                </code>
              </button>
            ))}
          </div>
          <div className="dock-actions">
            <button
              className="button quiet"
              onClick={() =>
                copy(
                  location.origin +
                    location.pathname +
                    encodePaletteHash(colors),
                  "share",
                )
              }
              disabled={busy || !selected}
            >
              <Icon name={copied === "share" ? "check" : "link"} size={16} />
              {copied === "share" ? "Link copied" : "Share"}
            </button>
            <button
              className="button quiet"
              onClick={() => void saveCard()}
              disabled={busy || !selected}
            >
              <Icon name="download" size={16} /> Save PNG
            </button>
            <button
              className="button secondary"
              onClick={() => copy(exportPalette(colors, format), "dock")}
              disabled={busy || !selected}
            >
              <Icon name={copied === "dock" ? "check" : "copy"} size={16} />
              {copied === "dock" ? "Copied" : "Copy palette"}
            </button>
          </div>
        </div>
        <section className="workbench" aria-label="Explore your palette">
          <div
            className="workbench-nav"
            role="tablist"
            aria-label="Palette tools"
          >
            {tabs.map((tab, i) => (
              <button
                key={tab.id}
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => {
                  const next =
                    e.key === "ArrowRight"
                      ? (i + 1) % tabs.length
                      : e.key === "ArrowLeft"
                        ? (i + tabs.length - 1) % tabs.length
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next !== null) {
                    e.preventDefault();
                    setActiveTab(tabs[next].id);
                    document.getElementById(`tab-${tabs[next].id}`)?.focus();
                  }
                }}
              >
                <Icon name={tab.icon} size={17} />
                {tab.label}
                {tab.id === "algorithm" && (
                  <span className="tab-tag">LIVE</span>
                )}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            className="tool-panel"
            tabIndex={0}
          >
            {activeTab === "context" && (
              <ThemePreview palette={colors} image={loaded?.src ?? null} />
            )}
            <Suspense fallback={null}>
              {activeTab === "contrast" && <ContrastPanel palette={colors} />}
              {activeTab === "algorithm" && (
                <PixelSpace
                  samples={palette.detail.samples}
                  steps={palette.detail.steps}
                  colorSpace={palette.detailColorSpace}
                />
              )}
              {activeTab === "export" && (
                <ExportPanel
                  palette={colors}
                  format={format}
                  onFormatChange={(value) => {
                    setFormat(value);
                    copyFeedback.setCopied(null);
                  }}
                  onCopy={() => copy(exportPalette(colors, format), "export")}
                  copied={copied === "export"}
                />
              )}
            </Suspense>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span>
          <Icon name="shield" size={15} /> Your images stay yours. Local uploads
          never leave this browser.
        </span>
        <a
          href="https://github.com/relaywright"
          target="_blank"
          rel="noreferrer"
        >
          A small tool by relaywright <Icon name="arrow" size={14} />
        </a>
      </footer>
      <span className="sr-only" role="status" aria-live="polite">
        {notice}
      </span>
      {dragging && (
        <div className="drop-overlay">
          <Icon name="upload" size={44} />
          <h2>A new point of hue.</h2>
          <p>Drop your image to find its palette.</p>
        </div>
      )}
    </div>
  );
}
