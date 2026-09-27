"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OcrCancelled } from "@/features/finance/receipt-ocr/read-receipt";
import { canReadFileText, readFileText, type FileText, type ReadProgress } from "./read-file-text";

/** A slow device gets this long; the file is saved without its words after that. */
export const TEXT_READ_TIMEOUT_MS = 120_000;

export type TextReaderState =
  | { kind: "idle" }
  | { kind: "running"; progress: ReadProgress }
  | { kind: "done"; found: boolean }
  | { kind: "failed" | "timed-out" | "skipped" };

type Run = {
  controller: AbortController;
  timer: number;
  timedOut: boolean;
  result: Promise<FileText | null>;
};

/**
 * Reads the words in one chosen file at a time, for search (#147). Choosing
 * another file, Skip, the timeout or unmounting stops the one in flight.
 * `result()` waits for the current file's words (null when there are none,
 * reading failed or was skipped), so a form can save them once its record
 * exists without ever being blocked by reading: Skip settles it at once.
 */
export function useFileTextReader() {
  const [state, setState] = useState<TextReaderState>({ kind: "idle" });
  const current = useRef<Run | null>(null);

  // The most recent file's result, kept after the run finishes so the form
  // can collect it at save time.
  const latest = useRef<Promise<FileText | null>>(Promise.resolve(null));

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
    (file: File | null | undefined) => {
      stop();
      if (!file || !canReadFileText(file)) {
        setState({ kind: "idle" });
        return;
      }
      const controller = new AbortController();
      const run: Run = { controller, timer: 0, timedOut: false, result: Promise.resolve(null) };
      run.timer = window.setTimeout(() => {
        run.timedOut = true;
        controller.abort();
      }, TEXT_READ_TIMEOUT_MS);
      current.current = run;
      setState({ kind: "running", progress: { stage: "loading", percent: 0 } });

      run.result = readFileText(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (current.current === run) setState({ kind: "running", progress });
        },
      }).then(
        (found) => {
          window.clearTimeout(run.timer);
          if (current.current === run) {
            current.current = null;
            setState({ kind: "done", found: Boolean(found) });
          }
          return found;
        },
        (error: unknown) => {
          window.clearTimeout(run.timer);
          if (current.current === run) {
            current.current = null;
            setState({
              kind: run.timedOut ? "timed-out" : error instanceof OcrCancelled ? "skipped" : "failed",
            });
          }
          return null;
        },
      );
      latest.current = run.result;
    },
    [stop],
  );

  const result = useCallback(() => latest.current, []);

  const skip = useCallback(() => {
    if (stop()) setState({ kind: "skipped" });
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    latest.current = Promise.resolve(null);
    setState({ kind: "idle" });
  }, [stop]);

  return { state, read, result, skip, reset };
}

/** One line for the form, or null when there is nothing to say. */
export function textReaderMessage(state: TextReaderState): string | null {
  switch (state.kind) {
    case "running":
      return state.progress.stage === "loading"
        ? "Getting ready to read the words in this file, so it can be found by search…"
        : `Reading the words in this file for search… ${state.progress.percent}%`;
    case "done":
      return state.found
        ? "The words in this file were read. Search will find it by them."
        : "No words could be read in this file. It will be found by its title, description and tags.";
    case "failed":
      return "The words in this file could not be read. It will be found by its title, description and tags.";
    case "timed-out":
      return "Reading this file took too long. It will be found by its title, description and tags.";
    case "skipped":
      return "Skipped. This file will be found by its title, description and tags.";
    default:
      return null;
  }
}
