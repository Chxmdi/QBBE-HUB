import { describe, expect, it } from "vitest";
import {
  classifyDocumentSchema,
  describePeriod,
  describeRetainUntil,
  fiscalYearEndSchema,
  localizeCategory,
  placeHoldSchema,
  releaseHoldSchema,
  saveRuleSchema,
  summarizeRegister,
  type RecordCategory,
  type RegisterRow,
} from "@/features/record-retention/schemas";
import { createTranslator } from "@/lib/i18n/translate";

const ID = "11111111-1111-4111-8111-111111111111";

function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : result.error!.issues[0].message;
}

describe("fiscal year end", () => {
  it("accepts every real day, including the last of each month", () => {
    for (const [month, day] of [[1, 31], [2, 28], [3, 31], [4, 30], [6, 30], [9, 30], [11, 30], [12, 31]]) {
      expect(fiscalYearEndSchema.safeParse({ month, day }).success, `${month}/${day}`).toBe(true);
    }
  });

  it("refuses days that do not exist, February 29 included", () => {
    for (const [month, day] of [[2, 29], [2, 30], [4, 31], [6, 31], [9, 31], [11, 31]]) {
      const result = fiscalYearEndSchema.safeParse({ month, day });
      expect(result.success, `${month}/${day}`).toBe(false);
      expect(firstError(result)).toMatch(/does not exist/);
    }
  });

  it("refuses months and days out of range, and reads form strings", () => {
    expect(firstError(fiscalYearEndSchema.safeParse({ month: 0, day: 1 }))).toBe("Choose a month.");
    expect(firstError(fiscalYearEndSchema.safeParse({ month: 13, day: 1 }))).toBe("Choose a month.");
    expect(firstError(fiscalYearEndSchema.safeParse({ month: 3, day: 0 }))).toBe("Choose a day.");
    expect(fiscalYearEndSchema.safeParse({ month: "3", day: "31" })).toEqual({ success: true, data: { month: 3, day: 31 } });
  });
});

describe("retention rule", () => {
  const base = { categoryKey: "receipts", confirmed: "on" };

  it("takes whole years from 1 to 100, as typed in a form", () => {
    expect(saveRuleSchema.parse({ ...base, retainYears: " 6 " }).retainYears).toBe(6);
    expect(saveRuleSchema.parse({ ...base, retainYears: 1 }).retainYears).toBe(1);
    expect(saveRuleSchema.parse({ ...base, retainYears: 100 }).retainYears).toBe(100);
    expect(saveRuleSchema.parse({ ...base, retainYears: null }).retainYears).toBeNull();
  });

  it("explains each wrong number of years", () => {
    expect(firstError(saveRuleSchema.safeParse({ ...base, retainYears: 0 }))).toBe("Enter at least one year.");
    expect(firstError(saveRuleSchema.safeParse({ ...base, retainYears: 101 }))).toBe("Enter 100 years or fewer.");
    expect(firstError(saveRuleSchema.safeParse({ ...base, retainYears: 2.5 }))).toBe("Enter a whole number of years.");
    expect(saveRuleSchema.safeParse({ ...base, retainYears: "six" }).success).toBe(false);
  });

  it("needs a category, and treats a missing confirmation as not confirmed", () => {
    expect(firstError(saveRuleSchema.safeParse({ categoryKey: "", retainYears: 6 }))).toBe("Choose a record category.");
    expect(saveRuleSchema.parse({ categoryKey: "receipts", retainYears: 6 }).confirmed).toBe(false);
    expect(saveRuleSchema.safeParse({ ...base, retainYears: 6, confirmationNote: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("legal holds", () => {
  it("a category hold needs the category and a reason", () => {
    expect(placeHoldSchema.safeParse({ scope: "category", categoryKey: "receipts", reason: "Audit request" }).success).toBe(true);
    expect(firstError(placeHoldSchema.safeParse({ scope: "category", categoryKey: "", reason: "Audit request" }))).toBe(
      "Choose a record category.",
    );
    expect(firstError(placeHoldSchema.safeParse({ scope: "category", categoryKey: "receipts", reason: "ab" }))).toBe(
      "Say why the hold is needed.",
    );
  });

  it("a record hold needs a real document id", () => {
    expect(placeHoldSchema.safeParse({ scope: "record", recordId: ID, reason: "Litigation" }).success).toBe(true);
    expect(firstError(placeHoldSchema.safeParse({ scope: "record", recordId: "not-an-id", reason: "Litigation" }))).toBe(
      "Choose a document.",
    );
    expect(placeHoldSchema.safeParse({ scope: "everything", reason: "Litigation" }).success).toBe(false);
  });

  it("releasing a hold needs the hold and a reason", () => {
    expect(releaseHoldSchema.safeParse({ holdId: ID, reason: "Matter closed" }).success).toBe(true);
    expect(firstError(releaseHoldSchema.safeParse({ holdId: ID, reason: "  " }))).toMatch(/Say why the hold is being released/);
    expect(releaseHoldSchema.safeParse({ holdId: "x", reason: "Matter closed" }).success).toBe(false);
  });
});

describe("classifying a document", () => {
  it("takes an optional category and a YYYY-MM-DD date, or no date", () => {
    expect(classifyDocumentSchema.safeParse({ documentId: ID, categoryKey: "receipts", recordDate: "2026-03-31" }).success).toBe(true);
    expect(classifyDocumentSchema.safeParse({ documentId: ID, recordDate: "" }).success).toBe(true);
    expect(classifyDocumentSchema.safeParse({ documentId: ID }).success).toBe(true);
  });

  it("refuses other date shapes and a missing document", () => {
    expect(classifyDocumentSchema.safeParse({ documentId: ID, recordDate: "31/03/2026" }).success).toBe(false);
    expect(firstError(classifyDocumentSchema.safeParse({ documentId: "", recordDate: "" }))).toBe("Choose a document.");
  });
});

describe("reading periods and dates", () => {
  const en = createTranslator("en");
  const fr = createTranslator("fr-CA");

  it("describes permanent, one-year and many-year periods on both bases, in English and French", () => {
    for (const t of [en, fr]) {
      const permanent = describePeriod({ retention_basis: "permanent" }, 7, t);
      expect(describePeriod({ retention_basis: "record_date" }, null, t)).toBe(permanent);
      const texts = [
        describePeriod({ retention_basis: "fiscal_year_end" }, 1, t),
        describePeriod({ retention_basis: "fiscal_year_end" }, 6, t),
        describePeriod({ retention_basis: "record_date" }, 1, t),
        describePeriod({ retention_basis: "record_date" }, 6, t),
      ];
      // Four different sentences, none a raw message key, the count shown where it is more than one.
      expect(new Set([permanent, ...texts]).size).toBe(5);
      for (const text of [permanent, ...texts]) expect(text).not.toMatch(/^records\./);
      expect(texts[1]).toContain("6");
      expect(texts[3]).toContain("6");
    }
    expect(describePeriod({ retention_basis: "fiscal_year_end" }, 6, en)).not.toBe(
      describePeriod({ retention_basis: "fiscal_year_end" }, 6, fr),
    );
  });

  it("shows a retention date, permanence, or that no rule applies", () => {
    expect(describeRetainUntil("2032-03-31")).toBe("2032-03-31");
    expect(describeRetainUntil("2032-03-31", en, (d) => `on ${d}`)).toBe("on 2032-03-31");
    expect(describeRetainUntil("infinity", en)).not.toBe(describeRetainUntil(null, en));
    for (const value of ["infinity", null]) expect(describeRetainUntil(value, fr)).not.toMatch(/^records\./);
  });

  it("translates seeded categories and leaves unknown ones as stored", () => {
    const unknown: RecordCategory = {
      key: "custom-thing",
      label: "Custom",
      description: "Stored",
      retention_basis: "record_date",
      minimum_years: null,
      default_years: 3,
      legal_reference: "None",
      confirm_with: "counsel",
      sort_order: 1,
    };
    expect(localizeCategory(unknown, fr)).toBe(unknown);
  });
});

describe("register totals", () => {
  const row = (over: Partial<RegisterRow>): RegisterRow => ({
    record_type: "document",
    record_id: ID,
    title: "A record",
    category_key: "receipts",
    record_date: "2010-01-01",
    retain_until: "2017-03-31",
    held: false,
    past_retention: false,
    ...over,
  });

  it("counts held records, and only unheld records past retention, by category", () => {
    const totals = summarizeRegister([
      row({ past_retention: true }),
      row({ past_retention: true }),
      row({ past_retention: true, category_key: "minutes" }),
      row({ past_retention: true, held: true }),
      row({ held: true }),
      row({ past_retention: true, category_key: null }),
      row({}),
    ]);
    expect(totals).toEqual({ pastRetention: 4, held: 2, byCategory: { receipts: 2, minutes: 1, unclassified: 1 } });
  });

  it("is all zeros for an empty register", () => {
    expect(summarizeRegister([])).toEqual({ pastRetention: 0, held: 0, byCategory: {} });
  });
});
