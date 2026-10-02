import type { EditorT } from "@/features/editor/i18n";
import { documentIdFromRef } from "@/features/editor/adapter/files";

/**
 * Pure helpers for unit E3 (code and media blocks): the code block's
 * languages, the exact text it copies, and how a media block names itself
 * and decides whether its address can be shown at all.
 */

/** The languages the code block offers, in menu order. */
export const CODE_LANGUAGES = ["text", "javascript", "typescript", "python", "sql", "json", "html", "css", "bash"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** Language names are the same in both languages, except plain text. */
const LANGUAGE_NAMES: Record<Exclude<CodeLanguage, "text">, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  sql: "SQL",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  bash: "Bash",
};

/** A language's name in the picker, in the reader's language. */
export function codeLanguageName(language: CodeLanguage, t: EditorT): string {
  return language === "text" ? t("units.e3.code.plainText") : LANGUAGE_NAMES[language];
}

/** Other names a stored or pasted language may carry (```js, ```sh …). */
const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  "": "text",
  plain: "text",
  plaintext: "text",
  txt: "text",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  htm: "html",
  xml: "html",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
};

/** The offered language a stored value means, or null for one the picker does not list. */
export function codeLanguage(raw: unknown): CodeLanguage | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if ((CODE_LANGUAGES as readonly string[]).includes(value)) return value as CodeLanguage;
  return LANGUAGE_ALIASES[value] ?? null;
}

/** A code block's text exactly as written: every character, line break and space. */
export function codeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const node = part as { type?: string; text?: unknown; content?: unknown };
      if (node.type === "text" && typeof node.text === "string") return node.text;
      if (node.type === "link") return codeText(node.content);
      return "";
    })
    .join("");
}

export const MEDIA_KINDS = ["image", "video", "audio", "file"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Whether a media block's address can be shown: a file from the document
 * library (scanned) or a secure link. Anything else (javascript:, data:,
 * plain http, a damaged reference) is refused with its own message instead
 * of being handed to the browser.
 */
export function mediaAddress(raw: unknown): "empty" | "library" | "link" | "unsupported" {
  if (typeof raw !== "string" || raw.trim() === "") return "empty";
  const value = raw.trim();
  if (documentIdFromRef(value)) return "library";
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return "link";
  } catch {
    // Not an address at all.
  }
  return "unsupported";
}

/** The words a media block is announced by: what it is, and what it shows. */
export function mediaName(
  kind: MediaKind,
  props: { name?: unknown; caption?: unknown; alt?: unknown },
  t: EditorT,
): string {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const name = kind === "image" ? text(props.alt) || text(props.caption) || text(props.name) : text(props.name) || text(props.caption);
  return name ? t(`units.e3.media.named.${kind}`, { name }) : t(`units.e3.media.unnamed.${kind}`);
}

/** An image asks for alt text until it has some. */
export function needsAltText(props: { url?: unknown; alt?: unknown }): boolean {
  return mediaAddress(props.url) !== "empty" && !(typeof props.alt === "string" && props.alt.trim());
}
