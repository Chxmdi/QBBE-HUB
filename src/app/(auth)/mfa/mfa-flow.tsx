"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  isValidTotpCode,
  mfaErrorMessage,
  normalizeTotpCode,
  requiresAdministratorMfa,
  unverifiedTotpFactorIds,
  verifiedTotpFactors,
  type TotpFactorOption,
} from "@/features/auth/mfa";
import { recordMfaSecurityEvent } from "@/features/auth/services/mfa.commands";
import { useT } from "@/lib/i18n/client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type Phase = "checking" | "enrolling" | "challenge" | "setup" | "error";

export function MfaFlow() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialized = useRef(false);
  const [phase, setPhase] = useState<Phase>("checking");
  const [factors, setFactors] = useState<TotpFactorOption[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const finish = useCallback(() => {
    const target = safeRedirectPath(searchParams.get("next"));
    router.replace(target === "/mfa" ? "/" : target);
    router.refresh();
  }, [router, searchParams]);

  const startEnrollment = useCallback(async () => {
    setPhase("enrolling");
    setError(null);
    setEnrollment(null);
    setCode("");

    const supabase = createSupabaseBrowserClient();
    const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(mfaErrorMessage(listError.message, t));
      setPhase("error");
      return;
    }

    // An interrupted enrollment cannot show its secret again. Remove only
    // unverified TOTP factors before issuing a replacement enrollment.
    for (const factorId of unverifiedTotpFactorIds(existing.all)) {
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
      if (removeError) {
        setError(mfaErrorMessage(removeError.message, t));
        setPhase("error");
        return;
      }
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: t("auth.mfa.friendlyName"),
      issuer: "QBBE Hub",
    });
    if (enrollError) {
      setError(mfaErrorMessage(enrollError.message, t));
      setPhase("error");
      return;
    }

    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code.trim(),
      secret: data.totp.secret.trim(),
    });
    setPhase("setup");
  }, [t]);

  const initialize = useCallback(async () => {
    setPhase("checking");
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const [{ data: assurance, error: assuranceError }, { data, error: factorsError }] =
      await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);

    if (assuranceError || factorsError) {
      setError(mfaErrorMessage((assuranceError ?? factorsError)!.message, t));
      setPhase("error");
      return;
    }

    const verified = verifiedTotpFactors(data.all, t);
    if (
      !requiresAdministratorMfa(
        true,
        assurance.currentLevel,
        assurance.nextLevel,
        verified.length > 0,
      )
    ) {
      finish();
      return;
    }

    if (assurance.currentLevel === "aal2" && assurance.nextLevel === "aal1") {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        setError(mfaErrorMessage(refreshError.message, t));
        setPhase("error");
        return;
      }
    }

    if (verified.length > 0) {
      setFactors(verified);
      setSelectedFactorId(verified[0].id);
      setPhase("challenge");
      return;
    }

    await startEnrollment();
  }, [finish, startEnrollment, t]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void initialize();
  }, [initialize]);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidTotpCode(code)) {
      setError(t("auth.mfa.enterCode"));
      return;
    }

    const factorId = enrollment?.factorId ?? selectedFactorId;
    if (!factorId) {
      setError(t("auth.mfa.chooseAuthenticator"));
      return;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    setSubmitting(false);

    if (verifyError) {
      setCode("");
      setError(mfaErrorMessage(verifyError.message, t));
      return;
    }

    await recordMfaSecurityEvent(
      phase === "setup" ? "mfa_enrollment_completed" : "mfa_challenge_completed",
    );
    finish();
  }

  if (phase === "checking" || phase === "enrolling") {
    return (
      <div className="card p-6 text-center" role="status" aria-live="polite">
        <p className="text-sm font-medium">
          {phase === "checking" ? t("auth.mfa.checking") : t("auth.mfa.preparing")}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="card space-y-4 p-6">
        <p role="alert" className="text-[13px] text-danger-fg">{error}</p>
        <Button type="button" onClick={() => void initialize()} className="w-full">
          {t("auth.mfa.retry")}
        </Button>
        <SignOutButton />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <form onSubmit={verify} className="space-y-5">
        {phase === "setup" && enrollment ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">{t("auth.mfa.setupHeading")}</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {t("auth.mfa.setupBody")}
              </p>
            </div>
            <div className="flex justify-center rounded-(--radius-sm) bg-white p-3">
              <Image
                src={enrollment.qrCode}
                alt={t("auth.mfa.qrAlt")}
                width={224}
                height={224}
                unoptimized
              />
            </div>
            <div>
              <Label htmlFor="totp-secret">{t("auth.mfa.cantScan")}</Label>
              <p id="totp-secret-help" className="mb-2 text-[12.5px] text-muted">
                {t("auth.mfa.manualHelp")}
              </p>
              <Input
                id="totp-secret"
                value={enrollment.secret}
                readOnly
                spellCheck={false}
                aria-describedby="totp-secret-help"
                className="font-mono tracking-wide"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-base font-semibold">{t("auth.mfa.challengeHeading")}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {t("auth.mfa.challengeBody")}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              {t("auth.mfa.lostAccess")}
            </p>
            {factors.length > 1 ? (
              <div className="mt-4">
                <Label htmlFor="totp-factor">{t("auth.mfa.authenticator")}</Label>
                <Select
                  id="totp-factor"
                  value={selectedFactorId}
                  onChange={(event) => setSelectedFactorId(event.target.value)}
                >
                  {factors.map((factor) => (
                    <option key={factor.id} value={factor.id}>{factor.name}</option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        )}

        <div>
          <Label htmlFor="totp-code">{t("auth.mfa.codeLabel")}</Label>
          <Input
            id="totp-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
            aria-describedby="totp-code-help"
            autoFocus
          />
          <p id="totp-code-help" className="mt-1 text-[12.5px] text-muted">
            {t("auth.mfa.codeHelp")}
          </p>
        </div>

        {error ? <p role="alert" className="text-[13px] text-danger-fg">{error}</p> : null}

        <Button type="submit" loading={submitting} className="w-full">
          {phase === "setup" ? t("auth.mfa.enable") : t("auth.mfa.verify")}
        </Button>
      </form>
      <div className="mt-2">
        <SignOutButton />
      </div>
    </div>
  );
}

function SignOutButton() {
  const t = useT();
  return (
    <form action="/auth/sign-out" method="post">
      <Button type="submit" variant="ghost" className="w-full">{t("auth.mfa.signOut")}</Button>
    </form>
  );
}
