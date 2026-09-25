import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";

interface UseCopyFeedbackOptions {
  setError: (message: string | null) => void;
}

/**
 * Tracks which control most recently copied a value, clears the "copied"
 * confirmation after a short delay, and surfaces a status message for
 * screen readers.
 */
export function useCopyFeedback({ setError }: UseCopyFeedbackOptions) {
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const copyTimer = useRef<number>();

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const copy = async (text: string, key: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setNotice("Copied to clipboard.");
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
    } else
      setError(
        "Clipboard access is unavailable. Open Export palette to select and copy the values manually.",
      );
  };

  return { copied, setCopied, notice, setNotice, copy };
}
