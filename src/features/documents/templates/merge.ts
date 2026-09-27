/**
 * Document templates (#147): letters, contracts and acknowledgements merged
 * from records, in French or English. Pure functions, shared by the server
 * action that generates documents, the template form and unit tests.
 *
 * A template body is plain text with {{placeholders}}. The merge is a single
 * pass: a merged value is inserted as-is and never scanned again, so a name
 * that itself contains "{{…}}" stays literal text. Nothing here is markup;
 * the PDF writer escapes every character of the result.
 */

export const TEMPLATE_KINDS = [
  { id: "letter", en: "Letter", fr: "Lettre" },
  { id: "contract", en: "Contract", fr: "Contrat" },
  { id: "acknowledgement", en: "Acknowledgement", fr: "Accusé de réception" },
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]["id"];

export const TEMPLATE_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
] as const;
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]["id"];

export const RECORD_TYPES = [
  { id: "member", label: "A member of the organization" },
  { id: "contact", label: "A CRM contact" },
  { id: "gift", label: "A recorded gift" },
] as const;
export type RecordType = (typeof RECORD_TYPES)[number]["id"];

type FieldKind = "text" | "money" | "date";

/** Every placeholder a template may use, by the record it merges. */
export const PLACEHOLDERS: Record<RecordType | "common", Record<string, { kind: FieldKind; help: string }>> = {
  common: {
    today: { kind: "date", help: "Today's date" },
    "organization.name": { kind: "text", help: "Your organization's name" },
  },
  member: {
    "person.name": { kind: "text", help: "Full name" },
    "person.email": { kind: "text", help: "Email" },
    "person.title": { kind: "text", help: "Job title" },
    "person.role": { kind: "text", help: "Role in the hub" },
    "person.joined_on": { kind: "date", help: "Date they joined" },
  },
  contact: {
    "contact.name": { kind: "text", help: "Full name" },
    "contact.email": { kind: "text", help: "Email" },
    "contact.title": { kind: "text", help: "Role or title" },
    "contact.organization": { kind: "text", help: "Their organization" },
  },
  gift: {
    "donor.name": { kind: "text", help: "Donor (person or organization)" },
    "gift.number": { kind: "text", help: "Gift reference number" },
    "gift.amount": { kind: "money", help: "Amount" },
    "gift.date": { kind: "date", help: "Date received" },
    "gift.description": { kind: "text", help: "What was given, for an in-kind gift" },
  },
};

export function placeholdersFor(recordType: RecordType): string[] {
  return [...Object.keys(PLACEHOLDERS.common), ...Object.keys(PLACEHOLDERS[recordType])];
}

const PLACEHOLDER = /\{\{\s*([a-z_.]+)\s*\}\}/g;

/** The distinct placeholder names a body uses, in order of first use. */
export function findPlaceholders(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** Placeholders the body uses that this record type cannot fill. */
export function unknownPlaceholders(body: string, recordType: RecordType): string[] {
  const allowed = placeholdersFor(recordType);
  return findPlaceholders(body).filter((name) => !allowed.includes(name));
}

export type MergeValue =
  | { kind: "text"; value: string | null | undefined }
  | { kind: "money"; cents: number | null | undefined }
  | { kind: "date"; value: string | null | undefined };

const MONTHS: Record<TemplateLanguage, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};

/** 123456 → "$1,234.56" (en) or "1 234,56 $" (fr). Integer cents only. */
export function formatMoney(cents: number, language: TemplateLanguage): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Amounts are integer cents");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const fraction = (abs % 100).toString().padStart(2, "0");
  const separator = language === "fr" ? " " : ",";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  const sign = negative ? "-" : "";
  return language === "fr"
    ? `${sign}${grouped},${fraction} $`
    : `${sign}$${grouped}.${fraction}`;
}

/** "2026-09-27" → "September 27, 2026" (en) or "27 septembre 2026" (fr). */
export function formatLongDate(isoDate: string, language: TemplateLanguage): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  const name = MONTHS[language][Number(month) - 1];
  if (!name) return isoDate;
  const d = Number(day);
  return language === "fr"
    ? `${d === 1 ? "1er" : d} ${name} ${year}`
    : `${name} ${d}, ${year}`;
}

function render(value: MergeValue | undefined, language: TemplateLanguage): string {
  if (!value) return "";
  switch (value.kind) {
    case "money":
      return value.cents == null ? "" : formatMoney(value.cents, language);
    case "date":
      return value.value ? formatLongDate(value.value, language) : "";
    default:
      return (value.value ?? "").toString();
  }
}

/**
 * Fills every placeholder in one pass. An unknown placeholder is an error
 * rather than left in the letter; a known one with no value becomes empty.
 */
export function mergeTemplate(
  body: string,
  values: Record<string, MergeValue>,
  language: TemplateLanguage,
  allowed: string[],
): string {
  return body.replace(PLACEHOLDER, (_whole, name: string) => {
    if (!allowed.includes(name)) throw new Error(`Unknown placeholder {{${name}}}`);
    // Merged values are one line of plain text: control characters and line
    // breaks in a record cannot restructure the document.
    return render(values[name], language)
      .replace(/[\u0000-\u001F\u007F]+/g, " ")
      .trim();
  });
}

/** The title of a generated document: "Thank-you letter – Jane Doe". */
export function generatedTitle(templateName: string, recordLabel: string): string {
  return `${templateName} – ${recordLabel}`.slice(0, 200);
}
