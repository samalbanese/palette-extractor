import {
  type RGB,
  rgbToHex,
  rgbToHsl,
  formatRgb,
  formatHsl,
  labelColorFor,
} from "./color";
import { nearestColorName } from "./names";

export type ExportFormat = "css" | "tailwind" | "scss" | "svg" | "json";

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  css: "CSS variables",
  tailwind: "Tailwind",
  scss: "SCSS",
  svg: "SVG",
  json: "JSON",
};

export function toCssVariables(palette: RGB[]): string {
  const lines = palette.map(
    (color, i) => `  --palette-${i + 1}: ${rgbToHex(color)};`,
  );
  return `:root {\n${lines.join("\n")}\n}`;
}

/** Tailwind v4 @theme block; drop it into the main CSS file. */
export function toTailwind(palette: RGB[]): string {
  const lines = palette.map(
    (color, i) => `  --color-palette-${i + 1}: ${rgbToHex(color)};`,
  );
  return `@theme {\n${lines.join("\n")}\n}`;
}

export function toJson(palette: RGB[]): string {
  const entries = palette.map((color) => ({
    name: nearestColorName(color),
    hex: rgbToHex(color),
    rgb: formatRgb(color),
    hsl: formatHsl(rgbToHsl(color)),
  }));
  return JSON.stringify(entries, null, 2);
}

export function toScss(palette: RGB[]): string {
  return palette
    .map((color, index) => `$palette-${index + 1}: ${rgbToHex(color)};`)
    .join("\n");
}

export function toSvg(palette: RGB[]): string {
  const swatchWidth = 120;
  const width = palette.length * swatchWidth;
  const swatches = palette
    .map((color, index) => {
      const hex = rgbToHex(color);
      const x = index * swatchWidth;
      const label = labelColorFor(color);
      return [
        `  <rect x="${x}" y="0" width="${swatchWidth}" height="120" fill="${hex}"/>`,
        `  <text x="${x + swatchWidth / 2}" y="66" text-anchor="middle" dominant-baseline="middle" fill="${label}" font-family="monospace" font-size="14">${hex}</text>`,
      ].join("\n");
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="120" viewBox="0 0 ${width} 120">\n${swatches}\n</svg>`;
}

export function exportPalette(palette: RGB[], format: ExportFormat): string {
  switch (format) {
    case "css":
      return toCssVariables(palette);
    case "tailwind":
      return toTailwind(palette);
    case "scss":
      return toScss(palette);
    case "svg":
      return toSvg(palette);
    case "json":
      return toJson(palette);
  }
}
