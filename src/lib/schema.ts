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
