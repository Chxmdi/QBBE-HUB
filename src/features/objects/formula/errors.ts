import type { Locale } from "@/lib/i18n/config";

/** Every way a formula can fail, with a message in each language. */
export const formulaErrorMessages = {
  too_long: { en: "The formula is longer than {max} characters.", fr: "La formule dépasse {max} caractères." },
  unexpected_character: { en: "Unexpected character “{char}” at position {position}.", fr: "Caractère inattendu « {char} » à la position {position}." },
  unterminated_string: { en: "A text value starting at position {position} is missing its closing quote.", fr: "Le texte qui commence à la position {position} n’a pas de guillemet fermant." },
  unexpected_token: { en: "Unexpected “{token}” at position {position}.", fr: "« {token} » inattendu à la position {position}." },
  unexpected_end: { en: "The formula ends too early.", fr: "La formule se termine trop tôt." },
  too_deep: { en: "The formula is nested too deeply.", fr: "La formule est trop imbriquée." },
  unknown_function: { en: "There is no function called “{name}”.", fr: "Il n’existe aucune fonction nommée « {name} »." },
  wrong_argument_count: { en: "{name}() takes {expected} value(s), not {actual}.", fr: "{name}() accepte {expected} valeur(s), pas {actual}." },
  unknown_property: { en: "There is no property called “{name}”.", fr: "Il n’existe aucune propriété nommée « {name} »." },
  property_name_not_text: { en: "prop() needs the property name in quotes.", fr: "prop() a besoin du nom de la propriété entre guillemets." },
  type_mismatch: { en: "{operation} cannot use {actual}; it needs {expected}.", fr: "{operation} ne peut pas utiliser {actual}; il faut {expected}." },
  division_by_zero: { en: "Division by zero.", fr: "Division par zéro." },
  invalid_date: { en: "“{value}” is not a date.", fr: "« {value} » n’est pas une date." },
  invalid_unit: { en: "“{unit}” is not a unit; use days, weeks, months or years.", fr: "« {unit} » n’est pas une unité; utilisez days, weeks, months ou years." },
  too_many_steps: { en: "The formula takes too long to calculate.", fr: "La formule prend trop de temps à calculer." },
  result_too_large: { en: "The result is too large.", fr: "Le résultat est trop grand." },
  circular_reference: { en: "“{name}” depends on itself through other formulas.", fr: "« {name} » dépend d’elle-même par d’autres formules." },
  missing_expression: { en: "This formula property has no formula yet.", fr: "Cette propriété de formule n’a pas encore de formule." },
} as const;

export type FormulaErrorCode = keyof typeof formulaErrorMessages;
export type FormulaErrorParams = Record<string, string | number>;

const TYPE_NAMES: Record<string, { en: string; fr: string }> = {
  number: { en: "a number", fr: "un nombre" },
  text: { en: "text", fr: "du texte" },
  boolean: { en: "true or false", fr: "vrai ou faux" },
  date: { en: "a date", fr: "une date" },
  list: { en: "a list", fr: "une liste" },
  empty: { en: "an empty value", fr: "une valeur vide" },
};

export class FormulaError extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    readonly params: FormulaErrorParams = {},
  ) {
    super(renderFormulaError(code, params, "en"));
    this.name = "FormulaError";
  }

  message_in(locale: Locale): string {
    return renderFormulaError(this.code, this.params, locale);
  }
}

export function renderFormulaError(code: FormulaErrorCode, params: FormulaErrorParams, locale: Locale): string {
  const language = locale === "fr-CA" ? "fr" : "en";
  const template: string = formulaErrorMessages[code][language];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) return `{${name}}`;
    if ((name === "expected" || name === "actual") && typeof value === "string" && TYPE_NAMES[value]) {
      return TYPE_NAMES[value][language];
    }
    return String(value);
  });
}
