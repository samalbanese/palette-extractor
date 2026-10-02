import { useState, type CSSProperties } from "react";
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
  id,
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
  changed,
}: {
  id: string;
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
  changed?: boolean;
}) {
  // Moving a node restarts its CSS animations, so the entrance class goes
  // once it has played and a later re-sort cannot replay it.
  const [entering, setEntering] = useState(true);
  const hex = rgbToHex(color);
  const value =
    valueKind === "hex"
      ? hex
      : valueKind === "rgb"
        ? formatRgb(color)
        : formatHsl(rgbToHsl(color));
  // The swatch's own ID keeps a confirmation with it as it moves and apart
  // from repeated colors; the value keeps a recolor from inheriting it.
  const copyKey = `swatch ${id} ${value}`;
  // The grid repaints --swatch and --label while a color melts; these are
  // the values at rest.
  return (
    <article
      className={`swatch ${entering ? "is-entering" : ""} ${selected ? "selected" : ""} ${changed ? "changed" : ""}`}
      data-swatch-id={id}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setEntering(false);
      }}
      style={
        {
          "--swatch": hex,
          "--label": labelColorFor(color),
          "--delay": `${index * 45}ms`,
        } as CSSProperties
      }
    >
      <div className="swatch-motion">
        <div className="swatch-color" data-swatch-index={index}>
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
          <button
            onClick={() => onCopy(value, copyKey)}
            aria-label={`Copy ${value}`}
          >
            <code>{copied === copyKey ? "Copied!" : value}</code>
            <Icon name={copied === copyKey ? "check" : "copy"} size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}
