/**
 * Why a file cannot be opened, in terms the uploader can act on. ClamAV
 * flags a password-protected PDF or archive by heuristic
 * (Heuristics.Encrypted.*): removing the password and uploading again works.
 * Anything else it finds is treated as a virus.
 */
export type QuarantineReason = "passwordProtected" | "virus" | "tooLarge" | "deleted";

export function quarantineReason(scanStatus: string | null | undefined, scanNote: string | null | undefined): QuarantineReason | null {
  const note = scanNote ?? "";
  if (scanStatus === "rejected") return note.startsWith("Deleted by an administrator") ? "deleted" : "tooLarge";
  if (scanStatus !== "quarantined") return null;
  if (note.startsWith("Deleted by an administrator")) return "deleted";
  if (/^Heuristics\.Encrypted\./.test(note)) return "passwordProtected";
  return "virus";
}

/** A quarantine an administrator may release: a heuristic, never a virus. */
export function isReleasable(scanStatus: string | null | undefined, scanNote: string | null | undefined): boolean {
  return scanStatus === "quarantined" && /^Heuristics\./.test(scanNote ?? "");
}
