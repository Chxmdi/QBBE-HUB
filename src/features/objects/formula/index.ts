import type { Locale } from "@/lib/i18n/config";
import { FormulaError } from "./errors";
import { evaluateNode, isDate, type FormulaContext, type FormulaValue } from "./evaluate";
import { formulaFunctions } from "./functions";
import { formulaDependencies, parseFormula, type FormulaNode } from "./parser";

export { FormulaError, formulaDependencies, parseFormula };
export type { FormulaContext, FormulaNode, FormulaValue };

/** What a formula property shows: a plain value, or a message in the viewer's language. */
export type FormulaResult =
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; code: FormulaError["code"]; message: string };

/**
 * Checks a formula when someone saves it: parses it and names unknown
 * functions and properties before it is ever evaluated.
 */
export function validateFormula(
  source: string,
  knownProperties: string[],
  locale: Locale,
): { ok: true; dependencies: string[] } | { ok: false; code: FormulaError["code"]; message: string } {
  try {
    const tree = parseFormula(source);
    const check = (node: FormulaNode) => {
      if (node.type === "call") {
        if (!formulaFunctions[node.name]) throw new FormulaError("unknown_function", { name: node.name });
        node.args.forEach(check);
      } else if (node.type === "unary") check(node.operand);
      else if (node.type === "binary") {
        check(node.left);
        check(node.right);
      }
    };
    check(tree);
    const known = new Set(knownProperties.map((name) => name.toLowerCase()));
    const dependencies = formulaDependencies(tree);
    const unknown = dependencies.find((name) => !known.has(name.toLowerCase()));
    if (unknown) throw new FormulaError("unknown_property", { name: unknown });
    return { ok: true, dependencies };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, code: error.code, message: error.message_in(locale) };
    throw error;
  }
}

/**
 * Evaluates a formula on the server for one object. Never throws for a bad
 * formula or bad data: the result says what went wrong, in the viewer's
 * language. There is no eval, no access to anything but `context`, and a
 * step limit, so a formula cannot run away.
 */
export function evaluateFormula(source: string | FormulaNode, context: FormulaContext, locale: Locale): FormulaResult {
  try {
    const tree = typeof source === "string" ? parseFormula(source) : source;
    const value: FormulaValue = evaluateNode(tree, context, formulaFunctions);
    if (Array.isArray(value)) return { ok: true, value: value.map((item) => (isDate(item) ? item.date : String(item ?? ""))).join(", ") };
    return { ok: true, value: isDate(value) ? value.date : value };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, code: error.code, message: error.message_in(locale) };
    throw error;
  }
}
