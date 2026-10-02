/**
 * Wave 2 unit E5: the editor's own timings, as performance marks. "Open" is
 * the first paint with the document's blocks on screen; "interactive" is the
 * first moment after that when the page is idle enough for a key press to be
 * handled at once (editable editors only). Both are measured from the start
 * of the browser's navigation, so tests and monitoring read them with
 * `performance.getEntriesByName(...)`.
 */

export const EDITOR_MARKS = {
  open: "qbbe-editor:open",
  interactive: "qbbe-editor:interactive",
} as const;
export type EditorMarkName = (typeof EDITOR_MARKS)[keyof typeof EDITOR_MARKS];

export interface EditorMarkDetail {
  /** The object's address, e.g. "/pages/<id>"; empty for task descriptions. */
  objectPath: string;
  /** Top-level blocks in the document when the mark was made. */
  blocks: number;
}

/** The part of the Performance API the editor uses (a fake in unit tests). */
export interface MarkPerformance {
  mark(name: string, options?: { detail?: unknown; startTime?: number }): unknown;
  getEntriesByName(name: string, type?: string): ReadonlyArray<{ startTime: number; detail?: unknown }>;
}

export function markEditor(perf: MarkPerformance | null | undefined, name: EditorMarkName, detail: EditorMarkDetail): boolean {
  if (!perf) return false;
  try {
    perf.mark(name, { detail });
    return true;
  } catch {
    // A browser without User Timing level 3 still opens the editor.
    return false;
  }
}

export interface EditorTimings {
  objectPath: string;
  blocks: number;
  /** Milliseconds from navigation start until the blocks were painted. */
  openMs: number | null;
  /** Milliseconds from navigation start until typing is handled at once. */
  interactiveMs: number | null;
}

function detailOf(entry: { detail?: unknown }): EditorMarkDetail | null {
  const d = entry.detail as Partial<EditorMarkDetail> | null | undefined;
  return d && typeof d.objectPath === "string" && typeof d.blocks === "number" ? { objectPath: d.objectPath, blocks: d.blocks } : null;
}

/** The latest open and interactive times for one object (or the latest editor). */
export function readEditorTimings(perf: MarkPerformance, objectPath?: string): EditorTimings | null {
  const latest = (name: EditorMarkName) =>
    perf
      .getEntriesByName(name, "mark")
      .filter((entry) => {
        const d = detailOf(entry);
        return d !== null && (objectPath === undefined || d.objectPath === objectPath);
      })
      .at(-1);
  const open = latest(EDITOR_MARKS.open);
  if (!open) return null;
  const detail = detailOf(open)!;
  const interactive = latest(EDITOR_MARKS.interactive);
  return {
    objectPath: detail.objectPath,
    blocks: detail.blocks,
    openMs: Math.round(open.startTime),
    interactiveMs: interactive && interactive.startTime >= open.startTime ? Math.round(interactive.startTime) : null,
  };
}
