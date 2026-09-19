import { describe, expect, it } from "vitest";
import type { Factor } from "@supabase/supabase-js";
import {
  isValidTotpCode,
  mfaErrorMessage,
  normalizeTotpCode,
  requiresAdministratorMfa,
  unverifiedTotpFactorIds,
  verifiedTotpFactors,
} from "@/features/auth/mfa";

const factors: Factor[] = [
  {
    id: "verified",
    factor_type: "totp",
    friendly_name: "Work phone",
    status: "verified",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "unfinished",
    factor_type: "totp",
    status: "unverified",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "phone",
    factor_type: "phone",
    status: "verified",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

describe("administrator TOTP MFA", () => {
  it("requires an administrator at AAL1 to step up without gating other members", () => {
    expect(requiresAdministratorMfa(true, "aal1", "aal1", false)).toBe(true);
    expect(requiresAdministratorMfa(true, "aal1", "aal2", true)).toBe(true);
    expect(requiresAdministratorMfa(true, null, null, false)).toBe(true);
    expect(requiresAdministratorMfa(true, "aal2", "aal2", true)).toBe(false);
    expect(requiresAdministratorMfa(false, "aal1", "aal2", false)).toBe(false);
  });

  it("rejects an AAL2 token whose last factor has been removed", () => {
    expect(requiresAdministratorMfa(true, "aal2", "aal1", true)).toBe(true);
    expect(requiresAdministratorMfa(true, "aal2", undefined, true)).toBe(true);
    expect(requiresAdministratorMfa(true, "aal2", "aal2", false)).toBe(true);
  });

  it("uses only verified TOTP factors for a login challenge", () => {
    expect(verifiedTotpFactors(factors)).toEqual([
      { id: "verified", name: "Work phone" },
    ]);
  });

  it("finds only interrupted TOTP enrollments for replacement", () => {
    expect(unverifiedTotpFactorIds(factors)).toEqual(["unfinished"]);
  });

  it("normalizes pasted codes and requires exactly six digits", () => {
    expect(normalizeTotpCode(" 12 34-567 ")).toBe("123456");
    expect(isValidTotpCode("123456")).toBe(true);
    expect(isValidTotpCode("12345")).toBe(false);
  });

  it("turns provider verification errors into actionable copy", () => {
    expect(mfaErrorMessage("mfa challenge expired")).toContain("expired");
    expect(mfaErrorMessage("mfa verification failed")).toContain("not accepted");
  });
});
