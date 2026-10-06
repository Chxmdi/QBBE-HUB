import { MAX_UPLOAD_BYTES } from "@/features/editor/adapter/files";

/**
 * Pasted files go through the editor's scanned upload (the document
 * library's pipeline): the block is shown at once, says it is uploading, then
 * that the security check is pending, until the file can be opened.
 */

export type FileBlockType = "image" | "video" | "audio" | "file";

/** The block a pasted file becomes, by its type. */
export function fileBlockType(mimeType: string): FileBlockType {
  const kind = mimeType.toLowerCase().split("/")[0];
  if (kind === "image" || kind === "video" || kind === "audio") return kind;
  return "file";
}

export type UploadState =
  | { state: "uploading"; name: string }
  | { state: "pending"; name: string }
  | { state: "failed"; name: string; reason: string }
  /** The file failed its security check: it is never served, so there is nothing to retry. */
  | { state: "refused"; name: string };

/** Whether a file can be sent at all (the library's own 25 MB limit). */
export function fileFits(size: number): boolean {
  return size <= MAX_UPLOAD_BYTES;
}

/** Milliseconds between checks of a pending scan: soon at first, then less often. */
export function nextScanCheckMs(attempt: number): number {
  return Math.min(2000 * 1.5 ** Math.max(0, attempt), 30_000);
}

/** How many times a pending scan is checked (about half an hour) before the page stops asking. */
export const MAX_SCAN_CHECKS = 70;

/**
 * What a block shows after a scan check: nothing once the file is clean, a
 * refusal once it failed, and "pending" otherwise (a scan not run yet, or an
 * answer that could not be read).
 */
export function afterScanCheck(scan: "pending" | "clean" | "refused" | "unknown"): "done" | "refused" | "pending" {
  if (scan === "clean") return "done";
  if (scan === "refused") return "refused";
  return "pending";
}
