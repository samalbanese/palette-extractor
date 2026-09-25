import { useEffect, useRef, useState } from "react";
import type { RGB } from "../lib/color";
import { decodePaletteHash } from "../lib/share";

/**
 * Reads a shared palette out of the URL hash on load and whenever the hash
 * changes afterward (back/forward navigation, pasting a new share link).
 */
export function useSharedPalette(onShared: (colors: RGB[]) => void) {
  const [shared, setShared] = useState(() => decodePaletteHash(location.hash));
  // Latest callback via ref, so the hashchange listener subscribes once.
  const onSharedRef = useRef(onShared);
  onSharedRef.current = onShared;

  useEffect(() => {
    const openShared = () => {
      const colors = decodePaletteHash(location.hash);
      if (!colors) return;
      setShared(colors);
      onSharedRef.current(colors);
    };
    window.addEventListener("hashchange", openShared);
    return () => window.removeEventListener("hashchange", openShared);
  }, []);

  return shared;
}
