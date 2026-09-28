"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OcrCancelled } from "@/features/finance/receipt-ocr/read-receipt";
import { canReadFileText, readFileText, type FileText, type ReadProgress } from "./read-file-text";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

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
export function textReaderMessage(
  state: TextReaderState,
  t: TranslateFn = createTranslator("en"),
): string | null {
  switch (state.kind) {
    case "running":
      return state.progress.stage === "loading"
        ? t("textReader.loading")
        : t("textReader.reading", { percent: state.progress.percent });
    case "done":
      return state.found ? t("textReader.found") : t("textReader.notFound");
    case "failed":
      return t("textReader.failed");
    case "timed-out":
      return t("textReader.timedOut");
    case "skipped":
      return t("textReader.skipped");
    default:
      return null;
  }
}
