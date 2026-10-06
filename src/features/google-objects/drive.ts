/**
 * Google Drive links (V1-15). A Drive file becomes a Hub object by being
 * linked as a document through the existing document link path, which checks
 * the approved hosts. This only recognises Drive addresses and their file id,
 * so the screen can refuse anything else before the server does.
 */

export type DriveKind = "document" | "spreadsheet" | "presentation" | "form" | "folder" | "file";

export interface DriveLink {
  fileId: string;
  kind: DriveKind;
  url: string;
}

const ID = "([A-Za-z0-9_-]{10,200})";
const PATTERNS: { host: string; path: RegExp; kind: DriveKind }[] = [
  { host: "docs.google.com", path: new RegExp(`^/document/d/${ID}`), kind: "document" },
  { host: "docs.google.com", path: new RegExp(`^/spreadsheets/d/${ID}`), kind: "spreadsheet" },
  { host: "docs.google.com", path: new RegExp(`^/presentation/d/${ID}`), kind: "presentation" },
  { host: "docs.google.com", path: new RegExp(`^/forms/d/${ID}`), kind: "form" },
  { host: "drive.google.com", path: new RegExp(`^/drive/(?:u/\\d+/)?folders/${ID}`), kind: "folder" },
  { host: "drive.google.com", path: new RegExp(`^/file/d/${ID}`), kind: "file" },
];

/** The Drive file behind an address, or null for anything that is not a Drive https link. */
export function parseDriveLink(raw: string): DriveLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  for (const pattern of PATTERNS) {
    const match = host === pattern.host ? pattern.path.exec(url.pathname) : null;
    if (match) return { fileId: match[1], kind: pattern.kind, url: url.toString() };
  }
  if (host === "drive.google.com" && url.pathname === "/open") {
    const id = url.searchParams.get("id");
    if (id && new RegExp(`^${ID}$`).test(id)) return { fileId: id, kind: "file", url: url.toString() };
  }
  return null;
}
