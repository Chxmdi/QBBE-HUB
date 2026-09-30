import type { Locale } from "@/lib/i18n/config";
import type { PropertyDefinition } from "@/lib/objects/contracts";
import { renderFormulaError } from "./errors";
import { evaluateFormula, formulaDependencies, parseFormula, type FormulaResult, type FormulaValue } from "./index";

/**
 * Calculates every formula property of one object on the server (V1-8).
 * Formulas may read other formulas; they are calculated in dependency order,
 * and a loop is reported on each formula in it instead of being followed.
 * `values` holds the object's other property values by key (system and
 * custom), already filtered to what the viewer may see, so a formula can
 * never reveal a private property.
 */
export function computeFormulaProperties(input: {
  definitions: Pick<PropertyDefinition, "key" | "kind" | "name" | "options">[];
  values: Record<string, FormulaValue>;
  today: string;
  locale: Locale;
}): Record<string, FormulaResult> {
  const { definitions, today, locale } = input;
  const formulas = definitions.filter((definition) => definition.kind === "formula");
  const names: Record<string, string> = {};
  for (const definition of definitions) {
    names[definition.name.en] = definition.key;
    names[definition.name.fr] = definition.key;
  }
  const byKey = new Map(formulas.map((definition) => [definition.key, definition]));
  const resolveKey = (name: string) => {
    const lower = name.toLowerCase();
    const match = definitions.find(
      (d) => d.key.toLowerCase() === lower || d.name.en.toLowerCase() === lower || d.name.fr.toLowerCase() === lower,
    );
    return match?.key ?? name;
  };

  const values: Record<string, FormulaValue> = { ...input.values };
  const results: Record<string, FormulaResult> = {};
  const state = new Map<string, "visiting" | "done">();

  const fail = (key: string, code: "circular_reference" | "missing_expression"): FormulaResult => ({
    ok: false,
    code,
    message: renderFormulaError(code, { name: byKey.get(key)?.name[locale === "fr-CA" ? "fr" : "en"] ?? key }, locale),
  });

  const compute = (key: string): FormulaResult => {
    if (state.get(key) === "done") return results[key];
    if (state.get(key) === "visiting") return fail(key, "circular_reference");
    state.set(key, "visiting");
    const definition = byKey.get(key)!;
    const expression = typeof definition.options.expression === "string" ? definition.options.expression : "";
    let result: FormulaResult;
    if (!expression.trim()) {
      result = fail(key, "missing_expression");
    } else {
      let tree;
      try {
        tree = parseFormula(expression);
      } catch {
        tree = null;
      }
      const loop = tree
        ? formulaDependencies(tree)
            .map(resolveKey)
            .filter((dependency) => byKey.has(dependency))
            .some((dependency) => {
              const inner = compute(dependency);
              return !inner.ok && inner.code === "circular_reference";
            })
        : false;
      result = loop
        ? fail(key, "circular_reference")
        : evaluateFormula(tree ?? expression, { properties: values, names, today }, locale);
    }
    values[key] = result.ok ? result.value : null;
    results[key] = result;
    state.set(key, "done");
    return result;
  };

  for (const definition of formulas) compute(definition.key);
  return results;
}
