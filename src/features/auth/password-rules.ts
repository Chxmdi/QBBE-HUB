/**
 * The one password rule. Supabase Auth enforces it (supabase/config.toml:
 * minimum_password_length and password_requirements, and the same settings
 * in each hosted project, see docs/runbooks/auth-settings.md); the forms
 * check it first only to explain a refusal before the round trip.
 * tests/unit/password-rules.test.ts keeps the two in step.
 */
export const MIN_PASSWORD_LENGTH = 12;
// Supabase Auth refuses anything longer (bcrypt reads only 72 bytes).
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordProblem = "tooShort" | "tooLong" | "needsMix";

/** What is wrong with a new password, or null when Auth will accept it. */
export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "tooShort";
  if (password.length > MAX_PASSWORD_LENGTH) return "tooLong";
  // Auth's "lower_upper_letters_digits": at least one of each.
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "needsMix";
  }
  return null;
}
