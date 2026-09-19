import type { Factor } from "@supabase/supabase-js";

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

export function verifiedTotpFactors(factors: Factor[]): TotpFactorOption[] {
  return factors
    .filter((factor) => factor.factor_type === "totp" && factor.status === "verified")
    .map((factor, index) => ({
      id: factor.id,
      name: factor.friendly_name?.trim() || `Authenticator ${index + 1}`,
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

export function mfaErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("expired")) {
    return "That code expired. Wait for a new code in your authenticator app and try again.";
  }
  if (
    normalized.includes("verify") ||
    normalized.includes("verification") ||
    normalized.includes("code")
  ) {
    return "That code was not accepted. Check the six digits and try again.";
  }
  if (normalized.includes("factor") && normalized.includes("exist")) {
    return "Authenticator setup is already in progress. Retry setup to continue.";
  }
  return "Multi-factor authentication is temporarily unavailable. Try again.";
}
