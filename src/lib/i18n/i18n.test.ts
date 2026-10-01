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
import { formatBalance, formatCents } from "@/features/ledger/money";

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

// Normalizes the narrow/non-breaking spaces Intl uses in French.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

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

// Words and names that are written the same in both languages. Anything else
// in the finance catalogues that is identical in French is English that was
// copied across and never translated.
const SAME_IN_BOTH = new Set([
  "Total", "total", "Date", "date", "Dates", "Description", "Notes", "Note", "Actions",
  "Type", "Code", "Source", "Section", "Administration", "Journal", "Budget", "Budgets",
  "Version", "Versions", "Net", "Active", "Restrictions", "%", "50", "Français",
  "Desjardins", "Desjardins (AccèsD)", "TD Canada Trust", "Revenu Québec", "CNESST",
  "Nethris (Desjardins)", "Employeur D", "ADP Workforce Now", "Ceridian Powerpay",
  "Budgets · {fiscalYear}", "v{version}", "Version {version}",
  "{name}, {fiscalYear}, version {version}",
]);

describe("finance catalogues", () => {
  it("translate every string that differs between the languages", () => {
    const french = flatten(frCA.finance);
    const copied = [...flatten(en.finance)]
      .filter(([key, value]) => french.get(key) === value && !SAME_IN_BOTH.has(value))
      .map(([key]) => key);
    expect(copied).toEqual([]);
  });

  it("format money and balances the Quebec way", () => {
    expect(plain(formatCents(123456, "fr-CA"))).toBe("1 234,56 $");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(plain(formatBalance(120000, "fr-CA"))).toBe("1 200,00 $ Dt");
    expect(plain(formatBalance(-30000, "fr-CA"))).toBe("300,00 $ Ct");
    expect(formatBalance(-30000)).toBe("$300.00 Cr");
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
        // "Budgets", "Documents", "Messages", "Signatures" and "Pages" are the same word in both languages.
        if (!["Budgets", "Documents", "Messages", "Signatures", "Pages"].includes(item.label)) {
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

// Each screen area owns its own top-level namespaces in `messages/workspace`,
// spread into the catalogue. Two areas claiming the same namespace would make
// one silently replace the other, so that fails here.
describe("workspace catalogues", () => {
  it("never claim the same top-level namespace twice", async () => {
    const modules = import.meta.glob("./messages/workspace/*.en.ts", { eager: true });
    const seen = new Map<string, string>();
    for (const [file, mod] of Object.entries(modules)) {
      for (const catalogue of Object.values(mod as Record<string, object>)) {
        for (const key of Object.keys(catalogue)) {
          expect(seen.get(key), `${key} in ${file}`).toBeUndefined();
          seen.set(key, file);
        }
      }
    }
    for (const key of seen.keys()) expect(en, key).toHaveProperty(key);
  });
});

// Words, names and codes written the same in both languages outside finance.
// Anything else identical in French is English that was copied across and
// never translated.
const SAME_OUTSIDE_FINANCE = new Set([
  "communication", "document", "documents", "invitation", "mention", "notification",
  "signature",
  " · Version {number}", ".", "Action", "Actions", "Active", "Administration",
  "Budgets", "CSV", "Communication", "Contact", "Contacts", "Conversation",
  "Date", "Description", "Direct", "Discussion", "Document", "Documents",
  "English", "Français", "Gmail", "Google", "Google Drive", "Impact",
  "Information", "Instructions", "Invitations", "Mentions", "Message", "Messages",
  "Navigation", "Note", "Notes", "Notifications", "Occurrences", "Options", "Page", "Pages",
  "PDF", "QBBE Hub", "Question {n}", "Questions", "Rose", "Sections",
  "Signature", "Signatures", "Type", "URL", "VMS", "Version {number}",
  "Versions", "accent", "active", "association", "communications",
  "compact", "danger", "direct", "discussion", "google",
  "https://drive.google.com/…", "information", "message", "note", "{category} / {name}", "{count} min",
  "{count} minute", "{count} minutes", "{greeting}, {name}", "{label} — {description}", "{status} {count}", "← Messages",
]);

describe("interface catalogues outside finance", () => {
  it("translate every string that differs between the languages", () => {
    const { finance: frenchFinance, ...frenchRest } = frCA;
    const { finance: englishFinance, ...englishRest } = en;
    void frenchFinance;
    void englishFinance;
    const french = flatten(frenchRest);
    const copied = [...flatten(englishRest)]
      .filter(([key, value]) => french.get(key) === value && !SAME_OUTSIDE_FINANCE.has(value))
      .map(([key]) => key);
    expect(copied).toEqual([]);
  });
});
