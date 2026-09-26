import { describe, expect, it } from "vitest";
import {
  answerText,
  assignFieldKeys,
  csvField,
  parseAnswers,
  parseMoneyToCents,
  parseOptions,
  type FormField,
} from "@/features/forms/fields";

const FIELDS: FormField[] = [
  { key: "field_1", label: "Name", type: "text", required: true },
  { key: "field_2", label: "Age", type: "number", required: false },
  { key: "field_3", label: "Fee", type: "money", required: false },
  { key: "field_4", label: "Day", type: "date", required: true },
  { key: "field_5", label: "Size", type: "choice", required: false, options: ["S", "M"] },
  { key: "field_6", label: "I agree", type: "checkbox", required: true },
  { key: "field_7", label: "Photo", type: "file", required: false },
];

describe("form answers", () => {
  it("converts money to integer cents and keeps the rest typed", () => {
    const parsed = parseAnswers(FIELDS, {
      field_1: "  Ana ", field_2: "12", field_3: "1 234,56 $", field_4: "2026-10-01",
      field_5: "M", field_6: "on", field_7: { path: "o/u/r/p.png", name: "p.png" }, extra: "dropped",
    });
    expect(parsed).toEqual({
      ok: true,
      answers: {
        field_1: "Ana", field_2: 12, field_3: 123456, field_4: "2026-10-01",
        field_5: "M", field_6: true, field_7: { path: "o/u/r/p.png", name: "p.png" },
      },
    });
  });

  it("names the field it refuses", () => {
    expect(parseAnswers(FIELDS, { field_4: "2026-10-01", field_6: true })).toEqual({
      ok: false, error: "Answer “Name”.",
    });
    expect(parseAnswers(FIELDS, { field_1: "A", field_4: "2026-10-01" })).toMatchObject({
      ok: false, error: "Tick “I agree” to continue.",
    });
    expect(parseAnswers(FIELDS, { field_1: "A", field_4: "2026-02-30", field_6: true })).toMatchObject({
      ok: false, error: "Enter a real date for “Day”.",
    });
    expect(parseAnswers(FIELDS, { field_1: "A", field_4: "2026-10-01", field_6: true, field_3: "4.567" }))
      .toMatchObject({ ok: false, error: "Enter “Fee” as an amount, like 42.18." });
    expect(parseAnswers(FIELDS, { field_1: "A", field_4: "2026-10-01", field_6: true, field_5: "XL" }))
      .toMatchObject({ ok: false });
  });

  it("stores an unticked optional checkbox as false and skips empty optionals", () => {
    const fields: FormField[] = [{ key: "a", label: "A", type: "checkbox", required: false },
      { key: "b", label: "B", type: "text", required: false }];
    expect(parseAnswers(fields, {})).toEqual({ ok: true, answers: { a: false } });
  });
});

describe("money", () => {
  it.each([
    ["42.18", 4218], ["42,18", 4218], ["$1,234.56", 123456], ["1.234,56", 123456], ["7", 700],
  ])("%s is %i cents", (input, cents) => expect(parseMoneyToCents(input)).toBe(cents));
  it.each(["4.567", "1,234", "-5", "abc", ""])("%s is refused", (input) =>
    expect(parseMoneyToCents(input)).toBeNull());
});

describe("builder helpers and export", () => {
  it("numbers keys in order and cleans options", () => {
    expect(assignFieldKeys([{ label: "A", type: "text", required: false }]).map((f) => f.key)).toEqual(["field_1"]);
    expect(parseOptions("S, M\nM\n  L  ,")).toEqual(["S", "M", "L"]);
  });
  it("renders answers for people and for spreadsheets", () => {
    expect(answerText(FIELDS[2], 4218)).toBe("$42.18");
    expect(answerText(FIELDS[2], 4218, true)).toBe("42.18");
    expect(answerText(FIELDS[5], undefined)).toBe("No");
    expect(answerText(FIELDS[6], { path: "x", name: "p.png" })).toBe("p.png");
  });
  it("neutralises spreadsheet formulas and quotes separators", () => {
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField(-5)).toBe("-5");
  });
});
