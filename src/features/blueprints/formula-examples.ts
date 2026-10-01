import { computeFormulaProperties } from "@/features/objects/formula/properties";
import { formulaDependencies, parseFormula, type FormulaValue } from "@/features/objects/formula";
import type { Locale } from "@/lib/i18n/config";
import type { PropertyKind } from "@/lib/objects/contracts";
import type { BlueprintProperty, BlueprintType } from "./schema";

/**
 * The worked example shown under a formula in the designer: "with Salary =
 * 65 000 and Stage = open → 5 416.67". Nothing is built yet, so the values
 * come from a sample record: a realistic one for each starter blueprint, and
 * a plain one by property kind for anything a person draws themselves. The
 * result is calculated by the same engine that will calculate the real
 * property (computeFormulaProperties), so what the example shows is what the
 * built property will do.
 */

/** Sample values by starter key, then type key, then property key. */
const starterSamples: Record<string, Record<string, Record<string, FormulaValue>>> = {
  recruiting: {
    job_opening: { title: "Program coordinator", stage: "open", department: "Programs", salary: 65000, closes_on: "2026-11-15" },
    candidate: { title: "Amina Diallo", stage: "interview" },
    interview: { title: "First interview", scheduled_for: "2026-10-22", score: 4 },
  },
  volunteer_intake: {
    volunteer: { title: "Marc Tremblay", status: "active", skills: ["tutoring", "events"], background_check: true },
    volunteer_shift: { title: "Saturday tutoring", starts_on: "2026-10-18", spots: 6, state: "open" },
  },
  event_planning: {
    planned_event: { title: "Fall gala", starts_on: "2026-11-07", ends_on: "2026-11-07", status: "confirmed", budget: 12000, capacity: 150 },
    event_session: { title: "Opening remarks", starts_at: "2026-11-07", room: "Hall A" },
    speaker: { title: "Dr. Lee" },
    registration: { title: "Table 4", status: "registered" },
  },
  grant: {
    funder: { title: "Community Foundation", kind: "foundation" },
    grant_application: { title: "Youth program 2027", stage: "submitted", deadline: "2026-12-01", amount_requested: 50000, amount_awarded: 35000 },
    grant_report: { title: "Mid-year report", due_on: "2027-06-30", state: "due" },
  },
  donor_stewardship: {
    donor: { title: "Jean Côté", tier: "mid", preferred_language: "french", next_contact: "2026-10-30" },
    donor_gift: { title: "Fall gift", amount: 250, received_on: "2026-10-02", method: "card", thanked: false },
    touchpoint: { title: "Thank-you call", happened_on: "2026-10-05", channel: "call" },
  },
  inventory: {
    stock_item: { title: "Folding chair", sku: "CH-100", category: "equipment", quantity: 48, reorder_level: 20, unit_cost: 32.5, status: "in_stock" },
    supplier: { title: "Office Plus" },
    stock_movement: { title: "Delivery", moved_on: "2026-10-03", change: 24, reason: "received" },
  },
};

/** A plain value for a kind, when no starter sample covers the property. */
function defaultValue(property: BlueprintProperty, today: string): FormulaValue {
  const kind = property.kind as PropertyKind;
  switch (kind) {
    case "number":
      return 12;
    case "currency":
      return 1250.5;
    case "duration":
      return 90;
    case "progress":
      return 60;
    case "rating":
      return 4;
    case "rollup":
      return 3;
    case "date":
    case "date_range":
      return today;
    case "checkbox":
      return true;
    case "status":
    case "select":
      return property.choices?.[0]?.key ?? "";
    case "multi_select":
      return property.choices?.slice(0, 2).map((c) => c.key) ?? [];
    case "person":
      return "Alex Tremblay";
    case "email":
      return "alex@example.org";
    case "phone":
      return "514 555-0100";
    case "url":
      return "https://example.org";
    case "file":
      return "plan.pdf";
    case "location":
      return "Montréal";
    case "relation":
    case "formula":
      return null;
    default:
      return "Example";
  }
}

/** The sample record for one type: starter values where they exist, plain ones elsewhere. */
export function sampleRecord(blueprintKey: string, type: BlueprintType, today: string): Record<string, FormulaValue> {
  const starter = starterSamples[blueprintKey]?.[type.key] ?? {};
  const record: Record<string, FormulaValue> = { title: starter.title ?? "Sample item" };
  for (const property of type.properties) {
    if (property.kind === "formula") continue;
    record[property.key] = property.key in starter ? starter[property.key] : defaultValue(property, today);
  }
  return record;
}

export type FormulaExample =
  | { ok: true; inputs: { name: string; value: string }[]; result: string }
  | { ok: false; message: string };

function show(value: FormulaValue, locale: Locale): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((item) => show(item, locale)).join(", ");
  if (typeof value === "object") return value.date;
  if (typeof value === "number") return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "boolean") return locale === "fr-CA" ? (value ? "vrai" : "faux") : value ? "true" : "false";
  return value;
}

/**
 * Works one formula property of a type over the sample record. Returns the
 * inputs it read (so the designer can show them) and the result, or the
 * engine's own message in the interface language when the formula fails.
 */
export function formulaExample(input: {
  blueprintKey: string;
  type: BlueprintType;
  property: BlueprintProperty;
  locale: Locale;
  today?: string;
}): FormulaExample | null {
  const { blueprintKey, type, property, locale } = input;
  if (property.kind !== "formula" || !property.expression?.trim()) return null;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const values = sampleRecord(blueprintKey, type, today);
  const definitions = type.properties.map((p) => ({
    key: p.key,
    kind: p.kind as PropertyKind,
    name: p.name,
    options: p.kind === "formula" ? { expression: p.expression ?? "" } : {},
  }));
  const results = computeFormulaProperties({ definitions, values, today, locale });
  const result = results[property.key];
  if (!result) return null;
  if (!result.ok) return { ok: false, message: result.message };

  const lower = (text: string) => text.toLowerCase();
  const inputs: { name: string; value: string }[] = [];
  const seen = new Set<string>();
  let names: string[] = [];
  try {
    names = formulaDependencies(parseFormula(property.expression));
  } catch {
    names = [];
  }
  for (const name of names) {
    const match =
      lower(name) === "title"
        ? { key: "title", label: locale === "fr-CA" ? "Titre" : "Title" }
        : (() => {
            const p = type.properties.find(
              (candidate) =>
                lower(candidate.key) === lower(name) ||
                lower(candidate.name.en) === lower(name) ||
                lower(candidate.name.fr) === lower(name),
            );
            return p ? { key: p.key, label: locale === "fr-CA" ? p.name.fr : p.name.en } : null;
          })();
    if (!match || seen.has(match.key)) continue;
    seen.add(match.key);
    const value =
      match.key in values
        ? values[match.key]
        : results[match.key]?.ok
          ? (results[match.key] as { value: FormulaValue }).value
          : null;
    inputs.push({ name: match.label || match.key, value: show(value, locale) });
  }
  return { ok: true, inputs, result: show(result.value, locale) };
}
