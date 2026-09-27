"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readReceiptText, type OcrProgress } from "./read-receipt";

/** A slow phone gets this long before reading gives up; typing is never blocked meanwhile. */
export const OCR_TIMEOUT_MS = 90_000;

export type ReaderState =
  | { kind: "idle" }
  | { kind: "running"; progress: OcrProgress }
  | { kind: "done"; text: string }
  | { kind: "failed" | "timed-out" | "skipped" };

/**
 * Runs the OCR for one chosen photo at a time: choosing another photo, Skip,
 * the timeout or unmounting stops the one in flight.
 */
export function useReceiptReader(onText: (text: string) => void) {
  const [state, setState] = useState<ReaderState>({ kind: "idle" });
  const current = useRef<{ controller: AbortController; timer: number; timedOut: boolean } | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const stop = useCallback(() => {
    const run = current.current;
    if (!run) return false;
    current.current = null;
    window.clearTimeout(run.timer);
    run.controller.abort();
    return true;
  }, []);

  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  const read = useCallback(
    (file: File) => {
      stop();
      const run = { controller: new AbortController(), timer: 0, timedOut: false };
      run.timer = window.setTimeout(() => {
        run.timedOut = true;
        run.controller.abort();
      }, OCR_TIMEOUT_MS);
      current.current = run;
      setState({ kind: "running", progress: { stage: "loading", percent: 0 } });

      readReceiptText(file, {
        signal: run.controller.signal,
        onProgress: (progress) => {
          if (current.current === run) setState({ kind: "running", progress });
        },
      }).then(
        (text) => {
          if (current.current !== run) return;
          window.clearTimeout(run.timer);
          current.current = null;
          setState({ kind: "done", text });
          onTextRef.current(text);
        },
        () => {
          // Skip, a newer photo or closing the dialog already moved on.
          if (current.current !== run) return;
          window.clearTimeout(run.timer);
          current.current = null;
          setState({ kind: run.timedOut ? "timed-out" : "failed" });
        },
      );
    },
    [stop],
  );

  const skip = useCallback(() => {
    if (stop()) setState({ kind: "skipped" });
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setState({ kind: "idle" });
  }, [stop]);

  return { state, read, skip, reset };
}
