/**
 * Form fields (#145) and the values people give them. The database checks
 * the same rules again (app.form_fields_problem, app.form_answers_normalized);
 * these exist so a person gets a plain sentence before anything is sent.
 * Money is integer cents end to end; floats never touch a stored amount.
 */

export const FIELD_TYPES = ["text", "number", "money", "date", "choice", "checkbox", "file"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  money: "Amount of money",
  date: "Date",
  choice: "Choice from a list",
  checkbox: "Checkbox",
  file: "File (photo or PDF)",
};

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  help?: string;
}

export interface FileAnswer {
  path: string;
  name: string;
}

export type AnswerValue = string | number | boolean | FileAnswer;
export type Answers = Record<string, AnswerValue>;

/**
 * The words a signer agrees to. Must match app.signature_consent_statement()
 * exactly: the database stores its own copy with every signature, and the
 * browser suite checks the two are the same.
 */
export const CONSENT_STATEMENT =
  "I agree to sign this record electronically. Typing my name is my signature, " +
  "and it has the same effect as signing it by hand.";

export const MAX_FIELDS = 50;

/** Stable keys for a list of fields: field_1, field_2, … in order. */
export function assignFieldKeys<T extends Omit<FormField, "key">>(fields: T[]): (T & { key: string })[] {
  return fields.map((field, index) => ({ ...field, key: `field_${index + 1}` }));
}

/** "S, M, L" or one per line → ["S", "M", "L"], trimmed, blanks and repeats dropped. */
export function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,]/)) {
    const option = part.trim();
    if (option) seen.add(option.slice(0, 200));
  }
  return [...seen];
}

/**
 * "42.18", "42,18", "$1,234.56", "1 234,56 $" → cents. Returns null for
 * anything that is not a non-negative amount with at most two decimals, so a
 * typo is refused rather than silently rounded.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[\s  $]/g, "");
  if (cleaned === "") return null;
  let whole: string;
  let fraction = "";
  const grouped = /^(\d{1,3}(?:([.,])\d{3})+)([.,])(\d{1,2})$/.exec(cleaned);
  if (grouped && grouped[2] !== grouped[3]) {
    whole = grouped[1].replace(/[.,]/g, "");
    fraction = grouped[4];
  } else {
    const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
    if (!plain) return null;
    whole = plain[1];
    fraction = plain[2] ?? "";
  }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const moneyFormatter = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export function formatCents(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

/** Plain decimal for spreadsheets: 4218 → "42.18". */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type ParsedAnswers = { ok: true; answers: Answers } | { ok: false; error: string };

/**
 * Turns what the browser sent (strings, a boolean for checkboxes, an uploaded
 * file's path and name) into the answers the database stores. Unknown keys
 * are dropped; every refusal names the field.
 */
export function parseAnswers(fields: FormField[], raw: Record<string, unknown>): ParsedAnswers {
  const answers: Answers = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (field.type === "checkbox") {
      const ticked = value === true || value === "true" || value === "on";
      if (field.required && !ticked) return { ok: false, error: `Tick “${field.label}” to continue.` };
      answers[field.key] = ticked;
      continue;
    }
    if (field.type === "file") {
      const file = value as Partial<FileAnswer> | null | undefined;
      if (!file || typeof file.path !== "string" || typeof file.name !== "string" || !file.path) {
        if (field.required) return { ok: false, error: `Attach a file for “${field.label}”.` };
        continue;
      }
      answers[field.key] = { path: file.path.slice(0, 500), name: file.name.slice(0, 200) || "file" };
      continue;
    }
    const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
    if (text === "") {
      if (field.required) return { ok: false, error: `Answer “${field.label}”.` };
      continue;
    }
    switch (field.type) {
      case "text":
        if (text.length > 5000) return { ok: false, error: `“${field.label}” can be at most 5,000 characters.` };
        answers[field.key] = text;
        break;
      case "number": {
        const n = Number(text.replace(",", "."));
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) {
          return { ok: false, error: `Enter a number for “${field.label}”.` };
        }
        answers[field.key] = n;
        break;
      }
      case "money": {
        const cents = parseMoneyToCents(text);
        if (cents === null || cents > 100_000_000_000) {
          return { ok: false, error: `Enter “${field.label}” as an amount, like 42.18.` };
        }
        answers[field.key] = cents;
        break;
      }
      case "date":
        if (!isRealDate(text)) return { ok: false, error: `Enter a real date for “${field.label}”.` };
        answers[field.key] = text;
        break;
      case "choice":
        if (!field.options?.includes(text)) {
          return { ok: false, error: `Choose one of the options for “${field.label}”.` };
        }
        answers[field.key] = text;
        break;
    }
  }
  return { ok: true, answers };
}

/** How a stored answer reads on screen and in the CSV. */
export function answerText(field: FormField, value: unknown, forSpreadsheet = false): string {
  if (value === undefined || value === null) return field.type === "checkbox" ? "No" : "";
  switch (field.type) {
    case "money":
      return typeof value === "number"
        ? forSpreadsheet ? centsToDecimal(value) : formatCents(value)
        : "";
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "file":
      return typeof value === "object" && value && "name" in value ? String((value as FileAnswer).name) : "";
    default:
      return String(value);
  }
}

/** One CSV field, quoted when it needs to be; formula-leading text is neutralised. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading =, +, - or @ would be run as a formula by Excel (CSV injection).
  if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
