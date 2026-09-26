import { describe, expect, it } from "vitest";
import {
  htmlLang,
  isLocale,
  localeFromAcceptLanguage,
} from "@/lib/i18n/config";
import { en } from "@/lib/i18n/messages/en";
import { frCA } from "@/lib/i18n/messages/fr-CA";
import { createTranslator, interpolate } from "@/lib/i18n/translate";
import { formatCurrency, formatNumber } from "@/lib/i18n/format";
import { NAV_GROUPS } from "@/config/navigation";
import { navGroupLabel, navItemLabel } from "@/lib/i18n/navigation";
import { dueLabel, formatDate, formatTime } from "@/lib/utils";

/** Every dotted key with its string, flattened. */
function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// The CI check the issue asks for: a key missing from French, or a French
// string that dropped or renamed a placeholder, fails here as well as in tsc.
describe("message catalogues", () => {
  const english = flatten(en);
  const french = flatten(frCA);

  it("have exactly the same keys", () => {
    expect([...french.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("have no empty strings", () => {
    for (const [key, value] of [...english, ...french]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders in both languages", () => {
    for (const [key, value] of english) {
      expect(placeholders(french.get(key) ?? ""), key).toEqual(placeholders(value));
    }
  });
});

describe("translator", () => {
  it("translates and interpolates", () => {
    const t = createTranslator("fr-CA");
    expect(t("nav.items.home")).toBe("Accueil");
    expect(t("topbar.notificationsUnread", { count: 3 })).toBe("Notifications (3 non lues)");
    expect(createTranslator("en")("nav.items.home")).toBe("Home");
  });

  it("leaves unknown placeholders visible rather than blank", () => {
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
  });

  it("names every navigation entry in French", () => {
    const t = createTranslator("fr-CA");
    for (const group of NAV_GROUPS) {
      // "Communication" is the same word in both languages.
      if (group.label !== "Communication") {
        expect(navGroupLabel(t, group), group.label).not.toBe(group.label);
      }
      for (const item of group.items) {
        const label = navItemLabel(t, item);
        // "Documents" and "Messages" are the same word in both languages.
        if (!["Documents", "Messages"].includes(item.label)) {
          expect(label, item.href).not.toBe(item.label);
        }
      }
    }
  });
});

describe("locale resolution", () => {
  it("accepts only supported locales", () => {
    expect(isLocale("fr-CA")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("reads Accept-Language in preference order", () => {
    expect(localeFromAcceptLanguage(null)).toBe("en");
    expect(localeFromAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr-CA");
    expect(localeFromAcceptLanguage("fr-FR")).toBe("fr-CA");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,fr;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("de;q=1, fr;q=0.5, en;q=0.7")).toBe("en");
    expect(localeFromAcceptLanguage("fr;q=0, en")).toBe("en");
    expect(localeFromAcceptLanguage("de, es")).toBe("en");
  });

  it("sets the html lang attribute", () => {
    expect(htmlLang("fr-CA")).toBe("fr-CA");
    expect(htmlLang("en")).toBe("en");
  });
});

// Normalizes the narrow/non-breaking spaces Intl uses in French.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("Quebec formats", () => {
  it("formats money and numbers", () => {
    expect(plain(formatCurrency(1234.56, "fr-CA"))).toBe("1 234,56 $");
    expect(formatCurrency(1234.56, "en")).toBe("$1,234.56");
    expect(plain(formatNumber(1234.5, "fr-CA"))).toBe("1 234,5");
  });

  it("formats dates and times", () => {
    const iso = "2026-09-26T18:30:00Z";
    expect(plain(formatDate(iso, "America/Toronto", "fr-CA"))).toBe("26 sept. 2026");
    expect(plain(formatTime(iso, "America/Toronto", "fr-CA"))).toBe("14 h 30");
    expect(formatTime(iso, "America/Toronto", "en")).toMatch(/2:30/);
  });

  it("labels due dates in French", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
    expect(dueLabel(today, "America/Toronto", "fr-CA").label).toBe("Échéance aujourd’hui");
    expect(dueLabel(null, "America/Toronto", "fr-CA").label).toBe("Aucune échéance");
  });
});
