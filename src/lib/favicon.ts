import { type RGB, rgbToHex } from "./color";

export function updatePaletteFavicon(palette: RGB[]): void {
  if (palette.length === 0) return;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.beginPath();
  ctx.roundRect(0, 0, 32, 32, 6);
  ctx.clip();
  const width = 32 / palette.length;
  palette.forEach((color, index) => {
    ctx.fillStyle = rgbToHex(color);
    ctx.fillRect(index * width, 0, width + 1, 32);
  });

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = canvas.toDataURL("image/png");
}
