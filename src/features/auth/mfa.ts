import type { Factor } from "@supabase/supabase-js";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

const english = createTranslator("en");

export interface TotpFactorOption {
  id: string;
  name: string;
}

export function requiresAdministratorMfa(
  isAdmin: boolean,
  currentLevel: string | null | undefined,
  nextLevel?: string | null,
  hasVerifiedTotpFactor?: boolean,
): boolean {
  if (!isAdmin) return false;

  // `aal2 -> aal1` is a stale JWT after the last factor was removed. Treat it
  // as downgraded immediately instead of waiting for the access token refresh
  // interval to lapse. Unknown levels also fail closed.
  return (
    currentLevel !== "aal2" ||
    nextLevel !== "aal2" ||
    hasVerifiedTotpFactor !== true
  );
}

export function verifiedTotpFactors(
  factors: Factor[],
  t: TranslateFn = english,
): TotpFactorOption[] {
  return factors
    .filter((factor) => factor.factor_type === "totp" && factor.status === "verified")
    .map((factor, index) => ({
      id: factor.id,
      name: factor.friendly_name?.trim() || t("auth.mfa.fallbackName", { number: index + 1 }),
    }));
}

export function unverifiedTotpFactorIds(factors: Factor[]): string[] {
  return factors
    .filter((factor) => factor.factor_type === "totp" && factor.status === "unverified")
    .map((factor) => factor.id);
}

export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isValidTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** Turns a provider error into a sentence for the person, in their language. */
export function mfaErrorMessage(message: string, t: TranslateFn = english): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("expired")) {
    return t("auth.mfa.errors.expired");
  }
  if (
    normalized.includes("verify") ||
    normalized.includes("verification") ||
    normalized.includes("code")
  ) {
    return t("auth.mfa.errors.rejected");
  }
  if (normalized.includes("factor") && normalized.includes("exist")) {
    return t("auth.mfa.errors.inProgress");
  }
  return t("auth.mfa.errors.unavailable");
}
