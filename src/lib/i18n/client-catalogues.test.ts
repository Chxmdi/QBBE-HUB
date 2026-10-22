import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { translatorFor } from "@/lib/i18n/translator";
import { en } from "@/lib/i18n/messages/en";
import { frCA } from "@/lib/i18n/messages/fr-CA";
import { formattersWith } from "@/lib/i18n/format-core";

/**
 * The browser gets only the active language's interface text. Every page used
 * to download both catalogues (about 183 KB compressed), because the client
 * provider, `cn()`'s module and the date formatters all imported the
 * translator that holds both. These tests walk the static imports from the
 * modules the browser always loads and fail if one of them can reach a
 * catalogue it should not.
 */

const ROOT = path.resolve(__dirname, "../../..");
const EN = "src/lib/i18n/messages/en.ts";
const FR = "src/lib/i18n/messages/fr-CA.ts";

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

/** Every file reachable by value imports (type-only imports are erased). */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.join(ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // Server actions reach the browser as references, never as code.
    if (/^\s*["']use server["']/.test(source)) continue;
    const pattern = /^\s*(import|export)\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
    for (const match of source.matchAll(pattern)) {
      const spec = match[3] ?? match[4];
      const target = resolve(file, spec);
      if (target) queue.push(target);
    }
  }
  return new Set([...seen].map((file) => path.relative(ROOT, file)));
}

describe("client language catalogues", () => {
  it("the shared client modules reach neither catalogue", () => {
    for (const entry of [
      "src/lib/i18n/client.tsx",
      "src/lib/utils.ts",
      "src/lib/i18n/format-core.ts",
      "src/components/ui/toast.tsx",
      "src/features/tasks/components/task-row.tsx",
      "src/features/tasks/components/task-list.tsx",
      "src/features/tasks/components/board.tsx",
      "src/features/lenses/components/task-card-bits.tsx",
      "src/features/documents/text-extract/use-file-text-reader.ts",
      "src/features/editor/adapter/blocknote/semantic-blocks.tsx",
    ]) {
      const files = reachable(entry);
      expect(files.has(EN), `${entry} reaches the English catalogue`).toBe(false);
      expect(files.has(FR), `${entry} reaches the French catalogue`).toBe(false);
    }
  });

  it("the provider loads each language's catalogue on demand, not statically", () => {
    const source = readFileSync(path.join(ROOT, "src/lib/i18n/client.tsx"), "utf8");
    expect(source).toContain('import("@/lib/i18n/messages/en")');
    expect(source).toContain('import("@/lib/i18n/messages/fr-CA")');
    // And the root layout renders that one provider, not one per language.
    const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("<I18nProvider locale={locale}>");
  });

  it("no browser module loads the both-language translator, except two that print in either language", () => {
    // The invoice sheet prints in the customer's language and the payroll
    // import matches English column names; both are staff finance pages.
    const allowed = new Set([
      "src/features/payables/invoice-language.ts",
      "src/features/payroll/parsers.ts",
    ]);
    const files = (readdirSync(path.join(ROOT, "src"), { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => path.join("src", file));
    const clients = files.filter((file) =>
      /^\s*["']use client["']/.test(readFileSync(path.join(ROOT, file), "utf8")),
    );
    const offenders = new Set<string>();
    for (const client of clients) {
      for (const file of reachable(client)) {
        if (allowed.has(file) || file === "src/lib/i18n/translate.ts") continue;
        const source = readFileSync(path.join(ROOT, file), "utf8");
        if (/^\s*["']use server["']/.test(source)) continue;
        if (/^\s*import\s+(?!type\b)[^;]*from\s+["']@\/lib\/i18n\/translate["']/m.test(source)) {
          offenders.add(file);
        }
      }
    }
    expect([...offenders].sort()).toEqual([]);
  });

  it("a translator over one catalogue gives the same text as the server's", () => {
    for (const [locale, catalog] of [["en", en], ["fr-CA", frCA]] as const) {
      const one = translatorFor(catalog);
      const server = createTranslator(locale);
      expect(one("nav.items.home")).toBe(server("nav.items.home"));
      expect(one("topbar.notificationsUnread", { count: 3 })).toBe(
        server("topbar.notificationsUnread", { count: 3 }),
      );
    }
  });

  it("due-date labels come from the translator handed in", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
    expect(formattersWith("fr-CA", translatorFor(frCA)).due(today, "America/Toronto").label).toBe(
      "Échéance aujourd’hui",
    );
    expect(formattersWith("en", translatorFor(en)).due(null).label).toBe(createTranslator("en")("due.none"));
  });
});
