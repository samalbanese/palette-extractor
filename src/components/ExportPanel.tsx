import { type RGB } from "../lib/color";
import {
  EXPORT_LABELS,
  exportPalette,
  type ExportFormat,
} from "../lib/exporters";
import { downloadBlob } from "../lib/paletteCard";
import { Icon } from "./Icon";

export function ExportPanel({
  palette,
  format,
  onFormatChange,
  onCopy,
  copied,
}: {
  palette: RGB[];
  format: ExportFormat;
  onFormatChange: (v: ExportFormat) => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const code = exportPalette(palette, format);
  const extensions = {
    css: "css",
    tailwind: "css",
    scss: "scss",
    svg: "svg",
    json: "json",
  };
  const download = () =>
    downloadBlob(
      new Blob([code], {
        type:
          format === "svg"
            ? "image/svg+xml"
            : format === "json"
              ? "application/json"
              : "text/plain",
      }),
      `palette.${extensions[format]}`,
    );
  return (
    <section className="export-panel" aria-label="Export palette">
      <div className="panel-intro">
        <span className="eyebrow">READY FOR YOUR NEXT PROJECT</span>
        <h2>
          Good color.
          <br />
          Ready to go.
        </h2>
        <p>
          Copy the values, download a file, or take a palette card with you. No
          cleanup required.
        </p>
        <label className="export-select">
          Export format
          <select
            aria-label="Export format"
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
          >
            {Object.entries(EXPORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          <button className="button primary" onClick={onCopy}>
            <Icon name={copied ? "check" : "copy"} />
            {copied ? "Copied" : "Copy code"}
          </button>
          <button className="button secondary" onClick={download}>
            <Icon name="download" /> Download
          </button>
        </div>
      </div>
      <div className="code-window">
        <div className="code-heading">
          <span>
            <i />
            <i />
            <i />
          </span>
          <code>palette.{extensions[format]}</code>
          <span>{EXPORT_LABELS[format]}</span>
        </div>
        <pre
          tabIndex={0}
          aria-label={`${EXPORT_LABELS[format]} export preview`}
        >
          <code>{code}</code>
        </pre>
      </div>
    </section>
  );
}
