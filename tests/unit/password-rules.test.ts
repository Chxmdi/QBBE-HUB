import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
} from "@/features/auth/password-rules";
import { createTranslator } from "@/lib/i18n/translate";

/**
 * One password rule for the forms and for Supabase Auth. The forms used to
 * say "at least 8" (sign-up) and "at least 12" (recovery) while Auth itself
 * accepted 6 characters with no other requirement, and both forms call Auth
 * directly from the browser, so only Auth's rule ever counted.
 */

describe("password rules", () => {
  it("asks for 12 characters with lower case, upper case and a digit", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordProblem("abc123")).toBe("tooShort");
    expect(passwordProblem("alllowercase1")).toBe("needsMix");
    expect(passwordProblem("ALLUPPERCASE1")).toBe("needsMix");
    expect(passwordProblem("NoDigitsHereAtAll")).toBe("needsMix");
    expect(passwordProblem("GoodPassword2026")).toBeNull();
    expect(passwordProblem("x".repeat(MAX_PASSWORD_LENGTH + 1))).toBe("tooLong");
  });

  it("matches Supabase Auth's settings in config.toml", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toMatch(new RegExp(`^minimum_password_length = ${MIN_PASSWORD_LENGTH}$`, "m"));
    expect(config).toMatch(/^password_requirements = "lower_upper_letters_digits"$/m);
    expect(config).toMatch(/^secure_password_change = true$/m);
  });

  it("explains each problem in both languages", () => {
    for (const locale of ["en", "fr-CA"] as const) {
      const t = createTranslator(locale);
      for (const key of ["auth.password.hint", "auth.password.tooShort", "auth.password.needsMix", "auth.password.tooLong"] as const) {
        const text = t(key, { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH });
        expect(text, `${locale} ${key}`).not.toBe(key);
        if (key !== "auth.password.needsMix") expect(text).toMatch(/\d/);
      }
    }
  });
});
