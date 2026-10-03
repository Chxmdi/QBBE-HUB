import { z } from "zod";

/**
 * A required piece of text, with one message for every way it can be absent.
 *
 * `.min(1, message)` on its own is not enough, and the gap is invisible in
 * review. Forms in this product drop empty values before submitting, so a
 * field left blank arrives *missing* rather than empty — and Zod then answers
 * with its own "Required", throwing away the sentence written for the person.
 *
 * Supplying required_error and invalid_type_error as well means the same words
 * appear however the value is absent: blank, omitted, or the wrong type. The
 * helper exists so that is decided once rather than remembered thirty-seven
 * times.
 */
export function requiredText(message: string, max?: number) {
  const text = z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(1, message);
  return max === undefined ? text : text.max(max);
}

/**
 * A real calendar day written as YYYY-MM-DD.
 *
 * The pattern alone lets 2026-02-31 through, and so does `Date.parse`, which
 * quietly rolls it over to March 3. Postgres refuses such a date, so a form or
 * a link carrying one ended in a generic failure (or a 500 on an export)
 * instead of a sentence saying what was wrong. Every date that arrives from a
 * person, a link or an API call is checked with this.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
