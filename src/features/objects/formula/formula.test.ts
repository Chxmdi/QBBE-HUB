import { describe, expect, it } from "vitest";
import { evaluateFormula, parseFormula, validateFormula, type FormulaContext } from "./index";
import { MAX_FORMULA_LENGTH } from "./parser";

const context: FormulaContext = {
  properties: {
    title: "Book the hall",
    estimate: 3,
    cost: 1250.5,
    due: "2026-10-20",
    start: "2026-10-01",
    done: false,
    tags: ["food", "youth"],
    empty_text: "",
    nothing: null,
  },
  names: { "Due date": "due", Coût: "cost" },
  today: "2026-10-15",
};

const run = (source: string, locale: "en" | "fr-CA" = "en") => evaluateFormula(source, context, locale);
const value = (source: string) => {
  const result = run(source);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};

describe("formula language: values and operators", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 / 4", 2.5],
    ["10 % 4", 2],
    ["-prop(\"estimate\") + 1", -2],
    ["2 > 1 and 1 == 1", true],
    ["not true || false", false],
    ["\"a\" + 1", "a1"],
    ["\"Plan: \" + prop(\"title\")", "Plan: Book the hall"],
    ["1 != 2", true],
    [".5 + 1.5e1", 15.5],
    ["null", null],
    ["vrai", true],
  ])("%s = %j", (source, expected) => {
    expect(value(source)).toBe(expected);
  });

  it("reads properties by key or display name, case-insensitively", () => {
    expect(value('prop("Due date")')).toBe("2026-10-20");
    expect(value('prop("coût") * 2')).toBe(2501);
    expect(value('prop("ESTIMATE")')).toBe(3);
  });
});

describe("formula language: functions", () => {
  it.each([
    ['if(prop("estimate") > 2, "big", "small")', "big"],
    ['if(prop("done"), 1 / 0, "not done")', "not done"],
    ["round(2.345, 2)", 2.35],
    ["round(2.5)", 3],
    ["floor(-1.5)", -2],
    ["abs(-4)", 4],
    ["min(3, 1, 2)", 1],
    ["max(list(3, 9), 2)", 9],
    ["sum(1, 2, 3)", 6],
    ["average(2, 4)", 3],
    ['toNumber("12,5")', 12.5],
    ['concat("a", 1, true)', "a1true"],
    ['length(prop("title"))', 13],
    ['length(prop("tags"))', 2],
    ['upper("école")', "ÉCOLE"],
    ['contains(prop("title"), "HALL")', true],
    ['contains(prop("tags"), "youth")', true],
    ['replace("a-b-c", "-", "+")', "a+b+c"],
    ['slice("abcdef", 1, 3)', "bc"],
    ['join(prop("tags"), " / ")', "food / youth"],
    ['empty(prop("empty_text"))', true],
    ['empty(prop("nothing"))', true],
    ['coalesce(prop("nothing"), "fallback")', "fallback"],
    ['count(prop("tags"))', 2],
    ["type(today())", "date"],
  ])("%s = %j", (source, expected) => {
    expect(value(source)).toBe(expected);
  });

  it("does date arithmetic in calendar days", () => {
    expect(value("today()")).toBe("2026-10-15");
    expect(value('dateAdd(prop("due"), 2, "weeks")')).toBe("2026-11-03");
    expect(value('dateAdd("2026-01-31", 1, "months")')).toBe("2026-02-28");
    expect(value('dateSubtract("2026-03-01", 1, "jours")')).toBe("2026-02-28");
    expect(value('dateBetween(prop("due"), today(), "days")')).toBe(5);
    expect(value('dateBetween("2027-10-20", prop("due"), "years")')).toBe(1);
    expect(value('dateBetween("2026-12-19", "2026-10-20", "months")')).toBe(1);
    expect(value('prop("due") > today()')).toBe(true);
    expect(value('year(prop("due")) + month(prop("due")) + day(prop("due"))')).toBe(2056);
  });
});

describe("formula language: safety and errors", () => {
  it("has no way out: no eval, globals or property access syntax", () => {
    for (const source of ['constructor("return process")()', "globalThis", "this.x", "[1]", "a = 1", "`x`", "process.env"]) {
      const result = run(source);
      expect(result.ok, source).toBe(false);
    }
    expect(run('prop("__proto__")')).toMatchObject({ ok: false, code: "unknown_property" });
    expect(run('prop("constructor")')).toMatchObject({ ok: false, code: "unknown_property" });
  });

  it("limits length, nesting, steps and result size", () => {
    expect(run("1+".repeat(MAX_FORMULA_LENGTH))).toMatchObject({ ok: false, code: "too_long" });
    expect(run("(".repeat(60) + "1" + ")".repeat(60))).toMatchObject({ ok: false, code: "too_deep" });
    const wide = `sum(${Array.from({ length: 50 }, () => `sum(${Array.from({ length: 50 }, () => "1").join(",")})`).join(",")})`;
    expect(run(wide.length <= MAX_FORMULA_LENGTH ? wide : "1")).toMatchObject({ ok: true });
    expect(run("10 ^ 2")).toMatchObject({ ok: false, code: "unexpected_character" });
    expect(run("1e308 * 10")).toMatchObject({ ok: false, code: "result_too_large" });
  });

  it("explains errors in English and French", () => {
    expect(run("1 / 0")).toEqual({ ok: false, code: "division_by_zero", message: "Division by zero." });
    expect(run("1 / 0", "fr-CA")).toEqual({ ok: false, code: "division_by_zero", message: "Division par zéro." });
    expect(run('"a" * 2', "fr-CA")).toMatchObject({ message: "* ne peut pas utiliser du texte; il faut un nombre." });
    expect(run('"a" * 2')).toMatchObject({ message: "* cannot use text; it needs a number." });
    expect(run("nope(1)", "fr-CA")).toMatchObject({ message: "Il n’existe aucune fonction nommée « nope »." });
    expect(run('round(1, 2, 3)')).toMatchObject({ code: "wrong_argument_count", message: "round() takes 1–2 value(s), not 3." });
    expect(run('"unterminated')).toMatchObject({ code: "unterminated_string" });
    expect(run("1 +")).toMatchObject({ code: "unexpected_end", message: "The formula ends too early." });
    expect(run("1 2", "fr-CA")).toMatchObject({ message: "« 2 » inattendu à la position 3." });
    expect(run('date("2026-02-30")')).toMatchObject({ code: "invalid_date" });
    expect(run('dateAdd(today(), 1, "fortnights")', "fr-CA")).toMatchObject({ code: "invalid_unit" });
    expect(run("prop(1)")).toMatchObject({ code: "property_name_not_text" });
  });

  it("validates before saving: unknown functions and properties, and lists dependencies", () => {
    expect(validateFormula('if(prop("estimate") > 2, prop("Due date"), today())', ["estimate", "Due date"], "en")).toEqual({
      ok: true,
      dependencies: ["estimate", "Due date"],
    });
    expect(validateFormula('prop("missing")', ["estimate"], "fr-CA")).toMatchObject({
      ok: false,
      message: "Il n’existe aucune propriété nommée « missing ».",
    });
    expect(validateFormula("frobnicate()", [], "en")).toMatchObject({ ok: false, code: "unknown_function" });
  });

  it("parses once and evaluates the tree many times", () => {
    const tree = parseFormula('prop("estimate") * 2');
    expect(evaluateFormula(tree, context, "en")).toEqual({ ok: true, value: 6 });
    expect(evaluateFormula(tree, { ...context, properties: { estimate: 5 } }, "en")).toEqual({ ok: true, value: 10 });
  });
});

describe("formula properties", () => {
  const def = (key: string, expression: string, en = key, fr = key) => ({
    key,
    kind: "formula" as const,
    name: { en, fr },
    options: { expression },
  });
  const plain = (key: string, en: string, fr: string) => ({ key, kind: "number" as const, name: { en, fr }, options: {} });

  it("calculates formulas that read other formulas, in dependency order", async () => {
    const { computeFormulaProperties } = await import("./properties");
    const results = computeFormulaProperties({
      definitions: [
        def("total", 'prop("Subtotal") + prop("tax")', "Total", "Total"),
        def("subtotal", 'prop("Unit cost") * prop("qty")', "Subtotal", "Sous-total"),
        def("tax", 'round(prop("subtotal") * 0.15, 2)'),
        plain("unit_cost", "Unit cost", "Coût unitaire"),
        plain("qty", "Quantity", "Quantité"),
      ],
      values: { unit_cost: 10, qty: 3 },
      today: "2026-10-15",
      locale: "en",
    });
    expect(results).toEqual({
      total: { ok: true, value: 34.5 },
      subtotal: { ok: true, value: 30 },
      tax: { ok: true, value: 4.5 },
    });
  });

  it("reports loops and missing formulas in the viewer's language instead of following them", async () => {
    const { computeFormulaProperties } = await import("./properties");
    const results = computeFormulaProperties({
      definitions: [def("a", 'prop("b") + 1', "A", "A"), def("b", 'prop("a") + 1', "B", "B"), def("c", "  ")],
      values: {},
      today: "2026-10-15",
      locale: "fr-CA",
    });
    expect(results.a).toMatchObject({ ok: false, code: "circular_reference", message: "« A » dépend d’elle-même par d’autres formules." });
    expect(results.b).toMatchObject({ ok: false, code: "circular_reference" });
    expect(results.c).toMatchObject({ ok: false, code: "missing_expression" });
  });

  it("cannot read a property the viewer was not given", async () => {
    const { computeFormulaProperties } = await import("./properties");
    const results = computeFormulaProperties({
      definitions: [def("leak", 'prop("salary")')],
      values: { estimate: 1 },
      today: "2026-10-15",
      locale: "en",
    });
    expect(results.leak).toMatchObject({ ok: false, code: "unknown_property" });
  });
});
