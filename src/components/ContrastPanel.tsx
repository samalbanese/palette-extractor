import { useEffect, useRef, useState } from "react";
import { type RGB, rgbToHex, labelColorFor } from "../lib/color";
import { readablePairs } from "../lib/contrast";
import { copyText } from "../lib/clipboard";

export function ContrastPanel({ palette }: { palette: RGB[] }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pairs = readablePairs(palette);
  const handleCopy = async (index: number, fg: string, bg: string) => {
    if (!(await copyText(`color: ${fg};\nbackground-color: ${bg};`))) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setCopiedIndex(index);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopiedIndex(null), 1600);
  };
  return (
    <section className="contrast-panel" aria-label="Readable color pairs">
      <div className="contrast-heading">
        <div>
          <span className="eyebrow">BEAUTIFUL IS ONLY THE BEGINNING</span>
          <h2>Make it readable.</h2>
          <p>
            Real contrast ratios between your colors, strongest first. Select a
            pairing to copy its text and background as CSS.
          </p>
        </div>
        <div className="contrast-legend">
          <span>AAA ≥ 7:1</span>
          <span>AA ≥ 4.5:1</span>
          <span>Large text ≥ 3:1</span>
        </div>
      </div>
      {failed && (
        <p role="alert">
          Clipboard unavailable. Use Export palette to select and copy the
          values.
        </p>
      )}
      {!pairs.length ? (
        <div className="contrast-empty">
          These colors are too close in brightness for readable text together.
          Try a different image or include more colors. A beautiful palette can
          still need a separate light or dark text color.
        </div>
      ) : (
        <ul className="contrast-grid">
          {pairs.map((pair, i) => {
            const fg = rgbToHex(pair.fg),
              bg = rgbToHex(pair.bg);
            return (
              <li key={`${fg}-${bg}`}>
                <button
                  className="contrast-pair"
                  onClick={() => void handleCopy(i, fg, bg)}
                  aria-label={`Copy CSS for ${fg} text on ${bg}, contrast ${pair.ratio.toFixed(2)} to 1, ${pair.level}`}
                >
                  <span
                    className="contrast-sample"
                    style={{ background: bg, color: fg }}
                  >
                    <span>Aa</span>
                    <span style={{ color: labelColorFor(pair.bg) }}>
                      {(Math.floor(pair.ratio * 100) / 100).toFixed(2)}:1
                      <br />
                      {pair.level === "AA Large"
                        ? "Large text only"
                        : pair.level}
                    </span>
                  </span>
                  <span className="contrast-meta">
                    <code aria-live="polite">
                      {copiedIndex === i ? "Copied CSS!" : `${fg} / ${bg}`}
                    </code>
                    <span>{pair.level}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="palette-hint">
        WCAG 2 contrast for text. Large text means at least 24px regular or
        about 19px bold. This checks color pairs, not an entire design.
      </p>
    </section>
  );
}
