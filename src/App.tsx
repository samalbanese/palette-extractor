import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import sunset from "./assets/sample.svg";
import { Swatch, type ValueKind } from "./components/Swatch";
import { ContrastPanel } from "./components/ContrastPanel";
import { PixelSpace } from "./components/PixelSpace";
import { ThemePreview } from "./components/ThemePreview";
import { ExportPanel } from "./components/ExportPanel";
import { Icon } from "./components/Icon";
import {
  type RGB,
  type SortMode,
  rgbToHex,
  rgbToHsl,
  formatRgb,
  formatHsl,
  sortPalette,
} from "./lib/color";
import {
  extractPaletteDetailed,
  resolveImageUrl,
  type ExtractionDetail,
} from "./lib/extract";
import { type ExportFormat, exportPalette } from "./lib/exporters";
import { copyText } from "./lib/clipboard";
import { nearestColorName } from "./lib/names";
import { decodePaletteHash, encodePaletteHash } from "./lib/share";
import { downloadBlob, renderPaletteCard } from "./lib/paletteCard";
import { updatePaletteFavicon } from "./lib/favicon";

interface Source {
  src: string;
  name: string;
  credit?: string;
  creditUrl?: string;
}
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
  const [shared, setShared] = useState(() => decodePaletteHash(location.hash));
  const [source, setSource] = useState<Source | null>(
    shared ? null : samples[0],
  );
  const [loaded, setLoaded] = useState<Source | null>(null);
  const [detail, setDetail] = useState<ExtractionDetail>({
    colors: shared?.map((color) => ({ color, population: 1 })) ?? [],
    pixels: [],
    steps: [],
  });
  const [locked, setLocked] = useState<RGB[]>(shared ?? []);
  const [count, setCount] = useState(shared?.length ?? 6);
  const [sort, setSort] = useState<SortMode>("original");
  const [valueKind, setValueKind] = useState<ValueKind>("hex");
  const [format, setFormat] = useState<ExportFormat>("css");
  const [activeTab, setActiveTab] = useState<Tab>("context");
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState(!shared);
  const [urlBusy, setUrlBusy] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const dragDepth = useRef(0);
  const loadRequest = useRef(0);
  const copyTimer = useRef<number>();
  const busy = extracting || urlBusy;

  useEffect(() => {
    const openShared = () => {
      const colors = decodePaletteHash(location.hash);
      if (!colors) return;
      loadRequest.current++;
      setShared(colors);
      setSource(null);
      setLoaded(null);
      setDetail({
        colors: colors.map((color) => ({ color, population: 1 })),
        pixels: [],
        steps: [],
      });
      setLocked(colors);
      setCount(colors.length);
      setExtracting(false);
      setUrlBusy(false);
      setError(null);
      setSelectedHex(null);
    };
    window.addEventListener("hashchange", openShared);
    return () => window.removeEventListener("hashchange", openShared);
  }, []);

  useEffect(
    () => () => {
      objectUrls.current.forEach(URL.revokeObjectURL);
      window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    objectUrls.current = objectUrls.current.filter((url) => {
      if (url === loaded?.src || url === source?.src) return true;
      URL.revokeObjectURL(url);
      return false;
    });
  }, [loaded, source]);

  const chooseSource = useCallback((next: Source) => {
    loadRequest.current++;
    setUrlBusy(false);
    setError(null);
    setCount((v) => Math.max(4, v));
    setSource(next);
    setShowUrl(false);
    if (location.hash.startsWith("#p="))
      history.replaceState(null, "", location.pathname + location.search);
  }, []);

  const loadFile = useCallback(
    (file?: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Choose an image file: JPG, PNG, WebP, GIF, or SVG.");
        return;
      }
      if (file.size > 30 * 1024 * 1024) {
        setError("That image is larger than 30 MB. Try a smaller version.");
        return;
      }
      const src = URL.createObjectURL(file);
      objectUrls.current.push(src);
      chooseSource({ src, name: file.name });
    },
    [chooseSource],
  );

  const loadUrl = useCallback(
    async (value: string) => {
      const id = ++loadRequest.current;
      setError(null);
      setUrlBusy(true);
      try {
        const parsed = new URL(value);
        if (!["https:", "http:"].includes(parsed.protocol))
          throw new Error(
            "Use a public image URL starting with https:// or http://.",
          );
        const src = await resolveImageUrl(parsed.href);
        if (id !== loadRequest.current) return;
        chooseSource({
          src,
          name: decodeURIComponent(
            parsed.pathname.split("/").pop() || parsed.hostname,
          ),
        });
      } catch (err) {
        if (id === loadRequest.current)
          setError(
            err instanceof TypeError
              ? "Enter a complete image URL, starting with https://."
              : (err as Error).message,
          );
      } finally {
        if (id === loadRequest.current) setUrlBusy(false);
      }
    },
    [chooseSource],
  );

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    setExtracting(true);
    const remaining = count - locked.length;
    const run = async () => {
      // Validate each new source even when every output slot is pinned.
      const next = await extractPaletteDetailed(
        source.src,
        Math.max(1, remaining),
        locked,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const unlocked =
        remaining > 0
          ? next.colors
              .filter(
                (e) => !locked.some((c) => rgbToHex(c) === rgbToHex(e.color)),
              )
              .slice(0, remaining)
          : [];
      setDetail({
        ...next,
        colors: [
          ...locked.map((color) => ({ color, population: 0 })),
          ...unlocked,
        ],
        ...(remaining <= 0 ? { pixels: [], steps: [] } : {}),
      });
      setLoaded(source);
      setSelectedHex(null);
      setError(null);
      setNotice(
        `${locked.length + unlocked.length} colors ready from ${source.name}.`,
      );
    };
    void run()
      .catch((err: Error) => {
        if (!controller.signal.aborted)
          setError(`${err.message} Your last palette is still available.`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setExtracting(false);
      });
    return () => controller.abort();
  }, [source, count, locked]);

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }
    };
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      loadFile(e.dataTransfer?.files[0]);
    };
    const paste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (item) {
        e.preventDefault();
        loadFile(item.getAsFile());
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('input,textarea,[contenteditable="true"]')
      )
        return;
      const text = e.clipboardData?.getData("text/plain").trim();
      if (text && /^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault();
        void loadUrl(text);
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [loadFile, loadUrl]);

  const sorted = useMemo(
    () => sortPalette(detail.colors, sort),
    [detail.colors, sort],
  );
  const colors = useMemo(() => sorted.map((e) => e.color), [sorted]);
  const selected = colors.find((c) => rgbToHex(c) === selectedHex) ?? colors[0];
  const total = sorted.reduce((sum, e) => sum + e.population, 0);
  const lockedSet = new Set(locked.map(rgbToHex));
  const showWeights = !!loaded && locked.length === 0;
  useEffect(() => {
    updatePaletteFavicon(colors);
  }, [colors]);

  const copy = async (text: string, key: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setNotice("Copied to clipboard.");
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
    } else
      setError(
        "Clipboard access is unavailable. Open Export palette to select and copy the values manually.",
      );
  };
  const toggleLock = (color: RGB) => {
    if (busy || !source) return;
    const hex = rgbToHex(color);
    setLocked((prev) =>
      prev.some((c) => rgbToHex(c) === hex)
        ? prev.filter((c) => rgbToHex(c) !== hex)
        : [...prev, color],
    );
  };
  const saveCard = async () => {
    try {
      const blob = await renderPaletteCard(
        colors.map((color) => ({ color, name: nearestColorName(color) })),
        loaded?.name ?? "Shared palette",
      );
      downloadBlob(blob, `palette-${rgbToHex(colors[0]).slice(1)}.png`);
      setNotice("Palette card downloaded.");
    } catch {
      setError(
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
            loadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && (
          <div role="alert" className="error-banner">
            <p>{error}</p>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
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
                    onClick={() => chooseSource(sample)}
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
                onClick={() => setShowUrl((v) => !v)}
              >
                <Icon name="link" size={14} /> Use URL
              </button>
            </div>
            {showUrl && (
              <form
                className="url-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadUrl(url);
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
                    onChange={(e) => setUrl(e.target.value)}
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
                    onToggleLock={() => toggleLock(entry.color)}
                    valueKind={valueKind}
                    onCopy={(text, key) => void copy(text, key)}
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
                  onClick={() => setCount((v) => v - 1)}
                  disabled={
                    !source || count <= Math.max(4, locked.length) || busy
                  }
                >
                  −
                </button>
                <output>{count}</output>
                <button
                  aria-label="More colors"
                  onClick={() => setCount((v) => v + 1)}
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
                  onChange={(e) => setSort(e.target.value as SortMode)}
                >
                  <option value="original">By dominance</option>
                  <option value="hue">By hue</option>
                  <option value="luminance">By lightness</option>
                </select>
              </label>
              {locked.length > 0 && source && (
                <button
                  className="text-button"
                  onClick={() => setLocked([])}
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
                  onClick={() => void copy(value, value)}
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
                  void copy(
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
                onClick={() =>
                  void copy(exportPalette(colors, format), "export")
                }
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
                pixels={detail.pixels}
                steps={detail.steps}
                palette={sorted}
              />
            )}
            {activeTab === "export" && (
              <ExportPanel
                palette={colors}
                format={format}
                onFormatChange={(value) => {
                  setFormat(value);
                  setCopied(null);
                }}
                onCopy={() =>
                  void copy(exportPalette(colors, format), "export")
                }
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
