import { type RGB, labelColorFor, rgbToHex } from "./color";

interface CardEntry {
  color: RGB;
  name: string;
}

export async function renderPaletteCard(
  entries: CardEntry[],
  sourceName: string,
): Promise<Blob> {
  if (!entries.length) throw new Error("There are no colors to save yet.");
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const footerHeight = 90;
  const swatchHeight = canvas.height - footerHeight;
  const columnWidth = canvas.width / entries.length;

  entries.forEach(({ color, name }, index) => {
    const x = index * columnWidth;
    ctx.fillStyle = rgbToHex(color);
    ctx.fillRect(x, 0, columnWidth + 1, swatchHeight);
    ctx.fillStyle = labelColorFor(color);
    ctx.textAlign = "center";
    ctx.font = '600 34px "Schibsted Grotesk", sans-serif';
    ctx.fillText(
      name,
      x + columnWidth / 2,
      swatchHeight - 92,
      columnWidth - 28,
    );
    ctx.font = '28px "Spline Sans Mono", monospace';
    ctx.fillText(rgbToHex(color), x + columnWidth / 2, swatchHeight - 48);
  });

  ctx.fillStyle = "#f7f5f0";
  ctx.fillRect(0, swatchHeight, canvas.width, footerHeight);
  ctx.fillStyle = "#403d37";
  ctx.font = '500 22px "Schibsted Grotesk", sans-serif';
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(sourceName, 46, swatchHeight + footerHeight / 2, 900);
  ctx.textAlign = "right";
  ctx.fillText(
    "P A L E T T E  E X T R A C T O R",
    1554,
    swatchHeight + footerHeight / 2,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not render the palette card."));
    }, "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
