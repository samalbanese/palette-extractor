import { useState } from "react";
import sunset from "./assets/sample.svg";
import { Swatch, type ValueKind } from "./components/Swatch";
import { ContrastPanel } from "./components/ContrastPanel";
import { PixelSpace } from "./components/PixelSpace";
import { ThemePreview } from "./components/ThemePreview";
import { ExportPanel } from "./components/ExportPanel";
import { Icon } from "./components/Icon";
import {
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
import { useCopyFeedback } from "./hooks/useCopyFeedback";
import { useSharedPalette } from "./hooks/useSharedPalette";

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
    creditUrl: "https://github.com/samalbanese/palette-extractor",
  },
];
const tabs = [
  { id: "context", label: "In context", icon: "image" },
  { id: "contrast", label: "Contrast check", icon: "contrast" },
  { id: "algorithm", label: "How it works", icon: "cube" },
  { id: "export", label: "Export palette", icon: "code" },
] as const;
type Tab = (typeof tabs)[number]["id"];

export default function App() {
  const [valueKind, setValueKind] = useState<ValueKind>("hex");
  const [format, setFormat] = useState<ExportFormat>("css");
  const [activeTab, setActiveTab] = useState<Tab>("context");
  const [selectedHex, setSelectedHex] = useState<string | null>(null);

  const shared = useSharedPalette((colors) => {
    imageSource.resetForShared();
    palette.loadShared(colors);
    setSelectedHex(null);
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
    setSelectedHex,
  });

  const { source, loaded, error, dragging, urlBusy, showUrl, url, fileInput } =
    imageSource;
  const { sorted, colors, total, lockedSet, count, locked, sort, busy } =
    palette;
  const { copied, notice } = copyFeedback;

  const selected = colors.find((c) => rgbToHex(c) === selectedHex) ?? colors[0];
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
            href="https://github.com/samalbanese/palette-extractor"
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
            <span className="eyebrow">AN IMAGE. A PALETTE. A POSSIBILITY.</span>
            <h1>
              Color, pulled into focus<span>.</span>
            </h1>
            <p>Find the colors worth keeping. Make something with them.</p>
          </div>
          <button
            className="button primary upload-main"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" /> Upload image{" "}
            <span className="shortcut">↗</span>
          </button>
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
          <section className="source-panel" aria-labelledby="source-heading">
            <div className="section-label">
              <h2 id="source-heading">
                <span>01</span> The source
              </h2>
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
                  src={(loaded ?? source)!.src}
                  alt={(loaded ?? source)!.name}
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
                  Remote images may be fetched through images.weserv.nl. Local
                  uploads stay on your device.
                </p>
              </form>
            )}
          </section>
          <section className="palette-panel" aria-labelledby="palette-heading">
            <div className="section-label">
              <h2 id="palette-heading">
                <span>02</span> The palette <b>{colors.length}</b>
              </h2>
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
              <div className={`swatch-grid format-${valueKind}`}>
                {sorted.map((entry, i) => (
                  <Swatch
                    key={`${rgbToHex(entry.color)}-${i}`}
                    color={entry.color}
                    index={i}
                    locked={lockedSet.has(rgbToHex(entry.color))}
                    weight={total ? entry.population / total : 0}
                    name={nearestColorName(entry.color)}
                    onToggleLock={() => palette.toggleLock(entry.color)}
                    valueKind={valueKind}
                    onCopy={(text, key) => copy(text, key)}
                    copied={copied}
                    selected={selectedHex === rgbToHex(entry.color)}
                    onSelect={() => setSelectedHex(rgbToHex(entry.color))}
                    showWeight={showWeights}
                    canLock={!!source}
                  />
                ))}
              </div>
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
              {showWeights
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
        {selected && (
          <div className="palette-dock">
            <div className="inspector">
              <i style={{ background: rgbToHex(selected) }} />
              <span>{nearestColorName(selected)}</span>
              {[
                rgbToHex(selected),
                formatRgb(selected),
                formatHsl(rgbToHsl(selected)),
              ].map((value) => (
                <button
                  key={value}
                  onClick={() => copy(value, value)}
                  aria-label={`Copy ${value} from inspector`}
                >
                  <code>{copied === value ? "Copied!" : value}</code>
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
                disabled={busy}
              >
                <Icon name={copied === "share" ? "check" : "link"} size={16} />
                {copied === "share" ? "Link copied" : "Share"}
              </button>
              <button
                className="button quiet"
                onClick={() => void saveCard()}
                disabled={busy}
              >
                <Icon name="download" size={16} /> Save PNG
              </button>
              <button
                className="button secondary"
                onClick={() => copy(exportPalette(colors, format), "export")}
                disabled={busy}
              >
                <Icon name={copied === "export" ? "check" : "copy"} size={16} />
                {copied === "export" ? "Copied" : "Copy palette"}
              </button>
            </div>
          </div>
        )}
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
            {activeTab === "contrast" && <ContrastPanel palette={colors} />}
            {activeTab === "algorithm" && (
              <PixelSpace
                pixels={palette.detail.pixels}
                steps={palette.detail.steps}
                palette={sorted}
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
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span>
          <Icon name="shield" size={15} /> Your images stay yours. Local uploads
          never leave this browser.
        </span>
        <a
          href="https://samalbanese.com/portfolio"
          target="_blank"
          rel="noreferrer"
        >
          A small tool by Sam Albanese <Icon name="arrow" size={14} />
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
