import { useCallback, useEffect, useRef, useState } from "react";
import { resolveImageUrl } from "../lib/extract";

export interface Source {
  src: string;
  name: string;
  credit?: string;
  creditUrl?: string;
}

interface UseImageSourceOptions {
  initialSource: Source | null;
  onSourceChosen: () => void;
}

/**
 * Tracks the image currently being viewed: uploads, drag-and-drop anywhere
 * on the window, clipboard paste, and public URLs. Keeps object URLs and
 * in-flight requests in sync with whichever source wins the race.
 */
export function useImageSource({
  initialSource,
  onSourceChosen,
}: UseImageSourceOptions) {
  const [source, setSource] = useState<Source | null>(initialSource);
  const [loaded, setLoaded] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [urlBusy, setUrlBusy] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const dragDepth = useRef(0);
  const loadRequest = useRef(0);
  // Always call the latest callback without changing chooseSource's identity,
  // so the window drag and paste listeners subscribe once.
  const onSourceChosenRef = useRef(onSourceChosen);
  onSourceChosenRef.current = onSourceChosen;

  useEffect(
    () => () => {
      objectUrls.current.forEach(URL.revokeObjectURL);
    },
    [],
  );

  useEffect(() => {
    objectUrls.current = objectUrls.current.filter((entry) => {
      if (entry === loaded?.src || entry === source?.src) return true;
      URL.revokeObjectURL(entry);
      return false;
    });
  }, [loaded, source]);

  const chooseSource = useCallback((next: Source) => {
    loadRequest.current++;
    setUrlBusy(false);
    setError(null);
    onSourceChosenRef.current();
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

  const resetForShared = useCallback(() => {
    loadRequest.current++;
    setSource(null);
    setLoaded(null);
    setUrlBusy(false);
    setError(null);
  }, []);

  return {
    source,
    loaded,
    setLoaded,
    error,
    setError,
    dragging,
    urlBusy,
    showUrl,
    setShowUrl,
    url,
    setUrl,
    fileInput,
    chooseSource,
    loadFile,
    loadUrl,
    resetForShared,
  };
}
