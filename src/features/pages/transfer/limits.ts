/** Import limits (wave 2 unit X1), shared by the import route and the sidebar's dialog. */

/** The largest file "Import" accepts. A long handbook in Markdown is well under this. */
export const IMPORT_MAX_BYTES = 1024 * 1024;
/** The largest page an import may create, as stored JSON (the editor's own save limit). */
export const IMPORT_MAX_CONTENT_BYTES = 4 * 1024 * 1024;
/** The file types the picker offers; the route decides by the same extensions. */
export const IMPORT_ACCEPT = ".md,.markdown,.txt,.html,.htm";

export type ImportKind = "markdown" | "html";

/** The kind of file by its name; anything else is refused. */
export function importKind(fileName: string): ImportKind | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName.trim())?.[1]?.toLowerCase();
  if (extension === "md" || extension === "markdown" || extension === "txt") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  return null;
}

export type ImportFileProblem = "empty" | "unsupported" | "tooLarge";

/** Why a file cannot be imported, or null when it may be sent. The route checks again. */
export function checkImportFile(file: { name: string; size: number }): ImportFileProblem | null {
  if (!importKind(file.name)) return "unsupported";
  if (file.size > IMPORT_MAX_BYTES) return "tooLarge";
  if (file.size === 0) return "empty";
  return null;
}
