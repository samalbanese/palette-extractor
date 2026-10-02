import { useEffect, useRef } from "react";
import { type RGB, rgbToHex } from "../lib/color";
import { ATMOSPHERE_OPACITY, atmosphereColors } from "../lib/atmosphere";
import "./atmosphere.css";

const FADE_MS = 600;

interface AtmosphereProps {
  palette: { color: RGB; population: number }[];
}

/**
 * A soft glow of the palette's most populous colors behind the workspace.
 * Purely decorative: it takes no space, no pointer input and no part in the
 * accessibility tree.
 */
export function Atmosphere({ palette }: AtmosphereProps) {
  const host = useRef<HTMLDivElement>(null);
  const glow = useRef<ReturnType<typeof createGlow>>();
  const colors = atmosphereColors(palette).map(rgbToHex);
  const key = colors.join(",");

  useEffect(() => {
    const current = createGlow(host.current!);
    glow.current = current;
    return () => current.dispose();
  }, []);
  useEffect(() => {
    glow.current!.show(key);
  }, [key]);

  return <div ref={host} className="atmosphere" aria-hidden="true" />;
}

/**
 * Owns the glow's layers. Each palette gets one layer; a change crossfades
 * the old layer out while the new one fades in, so their opacities always
 * sum to ATMOSPHERE_OPACITY. A palette arriving mid-fade waits for that fade
 * to finish, then the glow fades once to the latest palette, so at most two
 * layers ever exist.
 */
function createGlow(container: HTMLElement) {
  let shown: { key: string; layer: HTMLElement } | null = null;
  let fading: Animation[] = [];
  let pending: string | null = null;

  function layerFor(key: string) {
    const layer = document.createElement("div");
    layer.className = "atmosphere-layer";
    layer.dataset.colors = key;
    for (const hex of key ? key.split(",") : []) {
      const blob = document.createElement("i");
      // Opaque at the center, easing out to nothing at the edge.
      blob.style.background = `radial-gradient(closest-side, ${hex}, ${hex}d9 25%, ${hex}80 50%, ${hex}2e 75%, ${hex}00)`;
      layer.append(blob);
    }
    return layer;
  }

  function show(key: string) {
    if (fading.length) {
      pending = key;
      return;
    }
    if (shown?.key === key) return;
    const old = shown?.layer;
    const layer = layerFor(key);
    layer.style.opacity = String(ATMOSPHERE_OPACITY);
    shown = { key, layer };
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      old?.remove();
      container.append(layer);
      return;
    }
    container.append(layer);
    const timing = {
      duration: FADE_MS,
      easing: "ease-in-out",
      fill: "forwards" as const,
      id: "atmosphere-fade",
    };
    fading = [
      old.animate([{ opacity: ATMOSPHERE_OPACITY }, { opacity: 0 }], timing),
      layer.animate([{ opacity: 0 }, { opacity: ATMOSPHERE_OPACITY }], timing),
    ];
    Promise.all(fading.map((animation) => animation.finished)).then(
      () => {
        old.remove();
        fading.forEach((animation) => animation.cancel());
        fading = [];
        const next = pending;
        pending = null;
        if (next !== null) show(next);
      },
      // Cancelled on unmount; nothing is left to tidy.
      () => {},
    );
  }

  function dispose() {
    fading.forEach((animation) => animation.cancel());
    fading = [];
    container.replaceChildren();
  }

  return { show, dispose };
}
