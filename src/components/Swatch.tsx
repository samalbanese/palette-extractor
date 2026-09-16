import type { CSSProperties } from "react";
import {
  type RGB,
  rgbToHex,
  rgbToHsl,
  formatRgb,
  formatHsl,
  labelColorFor,
} from "../lib/color";
import { Icon } from "./Icon";
export type ValueKind = "hex" | "rgb" | "hsl";
export function Swatch({
  color,
  index,
  locked,
  weight,
  name,
  onToggleLock,
  valueKind,
  onCopy,
  copied,
  selected,
  onSelect,
  showWeight,
  canLock,
}: {
  color: RGB;
  index: number;
  locked: boolean;
  weight: number;
  name: string;
  onToggleLock: () => void;
  valueKind: ValueKind;
  onCopy: (text: string, key: string) => void;
  copied: string | null;
  selected: boolean;
  onSelect: () => void;
  showWeight: boolean;
  canLock: boolean;
}) {
  const hex = rgbToHex(color);
  const value =
    valueKind === "hex"
      ? hex
      : valueKind === "rgb"
        ? formatRgb(color)
        : formatHsl(rgbToHsl(color));
  return (
    <article
      className={`swatch ${selected ? "selected" : ""}`}
      style={
        {
          "--swatch": hex,
          "--label": labelColorFor(color),
          "--delay": `${index * 45}ms`,
        } as CSSProperties
      }
    >
      <div className="swatch-color">
        <button
          className="swatch-select"
          onClick={onSelect}
          aria-label={`Inspect ${name}, ${hex}`}
          aria-pressed={selected}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span>
            {showWeight
              ? `${(weight * 100).toFixed(1)}%`
              : locked
                ? "Kept"
                : "Extracted"}
          </span>
        </button>
        <button
          className={`lock-button ${locked ? "is-locked" : ""}`}
          onClick={onToggleLock}
          disabled={!canLock}
          aria-pressed={locked}
          aria-label={
            locked ? `Unlock ${hex}` : `Lock ${hex} and re-extract the rest`
          }
          title={
            !canLock
              ? "Add an image to change the palette"
              : locked
                ? "Unlock color"
                : "Keep this color"
          }
        >
          <Icon name={locked ? "lock" : "unlock"} size={15} />
        </button>
      </div>
      <div className="swatch-info">
        <span>{name}</span>
        <button onClick={() => onCopy(value, hex)} aria-label={`Copy ${value}`}>
          <code>{copied === hex ? "Copied!" : value}</code>
          <Icon name={copied === hex ? "check" : "copy"} size={13} />
        </button>
      </div>
    </article>
  );
}
