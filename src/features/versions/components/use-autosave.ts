"use client";

import { useEffect, useRef, useState } from "react";
import { createAutosaver, type Autosaver, type AutosaveStatus } from "../autosave";

/**
 * Autosave for any editor (M16a). Call `change` with the latest value; it is
 * saved after a short pause, retried on failure, and flushed when the page
 * is hidden or closed so a last edit is not lost.
 */
export function useAutosave<T>(save: (value: T) => Promise<boolean>, quietMs = 1500) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const saveRef = useRef(save);
  const saverRef = useRef<Autosaver<T> | null>(null);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    const saver = createAutosaver<T>({
      save: (value) => saveRef.current(value),
      quietMs,
      onStatus: (next, at) => {
        setStatus(next);
        if (at) setSavedAt(at);
      },
    });
    saverRef.current = saver;
    const flush = () => void saver.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      void saver.flush().finally(() => saver.dispose());
    };
  }, [quietMs]);

  return {
    status,
    savedAt,
    change: (value: T) => saverRef.current?.change(value),
    flush: () => saverRef.current?.flush() ?? Promise.resolve(),
  };
}
