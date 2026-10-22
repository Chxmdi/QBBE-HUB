import type { Messages } from "@/lib/i18n/messages/en";

/**
 * The translator itself, without any catalogue. The browser imports this and
 * loads the one language it needs on demand (I18nProvider in client.tsx);
 * importing a catalogue here would put both languages in every page again.
 */

export type { Messages };

/** Every dotted path to a string in the catalogue, e.g. "nav.home". */
export type MessageKey = Leaves<Messages>;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageVars = Record<string, string | number>;
export type TranslateFn = (key: MessageKey, vars?: MessageVars) => string;

function lookup(catalog: Messages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Replaces `{name}` placeholders. Unknown placeholders are left visible. */
export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * `t()` over one catalogue, with an optional second to fall back on. The
 * types make a missing key a compile error, so the fallback only matters for
 * a key typed as a plain string at runtime; the key itself is the last resort.
 */
export function translatorFor(catalog: Messages, fallback?: Messages): TranslateFn {
  return (key, vars) =>
    interpolate(lookup(catalog, key) ?? (fallback ? lookup(fallback, key) : undefined) ?? key, vars);
}
