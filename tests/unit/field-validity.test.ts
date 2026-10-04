import { describe, expect, it } from "vitest";
import { fieldProblem, type Validity } from "@/components/shared/field-validity";
import { createTranslator } from "@/lib/i18n/translate";

const ok: Validity = {
  valid: true,
  valueMissing: false,
  badInput: false,
  stepMismatch: false,
  rangeUnderflow: false,
  rangeOverflow: false,
  tooLong: false,
  typeMismatch: false,
};
const bad = (flag: keyof Omit<Validity, "valid">): Validity => ({ ...ok, valid: false, [flag]: true });
const en = createTranslator("en");
const fr = createTranslator("fr-CA");
const count = { type: "number", min: 0, max: 500 };

describe("plain messages for form fields (audit M3)", () => {
  it("says nothing about a valid field", () => {
    expect(fieldProblem(ok, count, en)).toBeNull();
  });

  it("names the limit instead of zod's 'Number must be greater than or equal to 0'", () => {
    expect(fieldProblem(bad("rangeUnderflow"), count, en)).toBe("Enter 0 or more.");
    expect(fieldProblem(bad("rangeOverflow"), count, en)).toBe("Enter 500 or less.");
    expect(fieldProblem(bad("rangeUnderflow"), count, fr)).toBe("Entrez 0 ou plus.");
  });

  it("explains each kind of problem in plain words, in both languages", () => {
    expect(fieldProblem(bad("valueMissing"), { type: "text" }, en)).toBe("Fill this in.");
    expect(fieldProblem(bad("valueMissing"), { type: "text" }, fr)).toBe("Remplissez ce champ.");
    expect(fieldProblem(bad("badInput"), count, en)).toBe("Enter a number.");
    expect(fieldProblem(bad("stepMismatch"), count, en)).toBe("Enter a whole number.");
    expect(fieldProblem(bad("tooLong"), { type: "text", maxLength: 200 }, en)).toBe("Use 200 characters or fewer.");
    expect(fieldProblem(bad("typeMismatch"), { type: "email" }, en)).toMatch(/^Enter an email address/);
    expect(fieldProblem(bad("typeMismatch"), { type: "url" }, fr)).toMatch(/^Entrez une adresse Web/);
  });

  it("puts a missing value first, since that is what the person has to fix", () => {
    expect(fieldProblem({ ...bad("valueMissing"), rangeUnderflow: true }, count, en)).toBe("Fill this in.");
  });
});
