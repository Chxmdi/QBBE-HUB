import { interpolate, type MessageVars } from "@/lib/i18n/translator";
import { cataloguesReady } from "@/lib/i18n/lazy-catalogues";
import type { Locale } from "@/lib/i18n/config";
import { catalogues } from "./catalogues";
import type { EditorMessages } from "./en";

const editorEn = catalogues.en;
const editorFrCA = catalogues["fr-CA"];

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type EditorKey = Leaves<EditorMessages>;
export type EditorT = (key: EditorKey, vars?: MessageVars) => string;

const CATALOGS: Record<Locale, EditorMessages> = { en: editorEn, "fr-CA": editorFrCA };

function lookup(catalog: EditorMessages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** `t()` for the editor module in one language, falling back to English. */
export function createEditorT(locale: Locale): EditorT {
  const catalog = CATALOGS[locale] ?? editorEn;
  return (key, vars) => interpolate(lookup(catalog, key) ?? lookup(editorEn, key) ?? key, vars);
}

export { editorEn, editorFrCA };

/** Waits, while rendering, until this module's text is loaded in `locale` (see cataloguesReady). */
export function editorTextReady(locale: Locale): void {
  cataloguesReady(locale, catalogues);
}
