"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import {
  isValidTotpCode,
  mfaErrorMessage,
  normalizeTotpCode,
  unverifiedTotpFactorIds,
  verifiedTotpFactors,
  type TotpFactorOption,
} from "@/features/auth/mfa";
import { recordMfaSecurityEvent } from "@/features/auth/services/mfa.commands";
import { useT } from "@/lib/i18n/client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function MfaSettings({
  initialFactors,
}: {
  initialFactors: TotpFactorOption[];
}) {
  const t = useT();
  const [factors, setFactors] = useState(initialFactors);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeFactor, setRemoveFactor] = useState<TotpFactorOption | null>(null);

  async function reloadFactors() {
    const supabase = createSupabaseBrowserClient();
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw listError;
    setFactors(verifiedTotpFactors(data.all, t));
  }

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCode("");
    const supabase = createSupabaseBrowserClient();
    const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(mfaErrorMessage(listError.message, t));
      setBusy(false);
      return;
    }

    for (const factorId of unverifiedTotpFactorIds(existing.all)) {
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
      if (removeError) {
        setError(mfaErrorMessage(removeError.message, t));
        setBusy(false);
        return;
      }
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: t("settings.mfa.friendlyName", { number: factors.length + 1 }),
      issuer: "QBBE Hub",
    });
    setBusy(false);
    if (enrollError) {
      setError(mfaErrorMessage(enrollError.message, t));
      return;
    }
    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code.trim(),
      secret: data.totp.secret.trim(),
    });
  }

  async function finishEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment || !isValidTotpCode(code)) {
      setError(t("auth.mfa.enterCode"));
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    });
    if (verifyError) {
      setCode("");
      setError(mfaErrorMessage(verifyError.message, t));
      setBusy(false);
      return;
    }

    await recordMfaSecurityEvent("mfa_enrollment_completed");
    try {
      await reloadFactors();
      setEnrollment(null);
      setCode("");
      setNotice(t("settings.mfa.added"));
    } catch (reloadError) {
      setError(mfaErrorMessage((reloadError as Error).message, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    if (!removeFactor) return;
    if (factors.length <= 1) {
      setRemoveFactor(null);
      setError(t("settings.mfa.keepOne"));
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createSupabaseBrowserClient();
    const { error: removeError } = await supabase.auth.mfa.unenroll({
      factorId: removeFactor.id,
    });
    if (removeError) {
      setError(mfaErrorMessage(removeError.message, t));
      setBusy(false);
      setRemoveFactor(null);
      return;
    }

    await supabase.auth.refreshSession();
    await recordMfaSecurityEvent("mfa_factor_removed");
    try {
      await reloadFactors();
      setNotice(t("settings.mfa.removed"));
    } catch (reloadError) {
      setError(mfaErrorMessage((reloadError as Error).message, t));
    } finally {
      setBusy(false);
      setRemoveFactor(null);
    }
  }

  // The factor name is bold inside the sentence, so split the sentence around it.
  const [removeBefore = "", removeAfter = ""] = t("settings.mfa.removeConfirm", {
    name: "\u0000",
  }).split("\u0000");

  return (
    <section className="card mt-6 p-5" aria-labelledby="mfa-settings-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="mfa-settings-heading" className="text-base font-semibold">
            {t("settings.mfa.heading")}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
            {t("settings.mfa.body")}
          </p>
        </div>
        {!enrollment ? (
          <Button type="button" variant="secondary" onClick={startEnrollment} loading={busy}>
            {t("settings.mfa.add")}
          </Button>
        ) : null}
      </div>

      {notice ? <p role="status" className="mt-4 text-[13px] text-success-fg">{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 text-[13px] text-danger-fg">{error}</p> : null}

      {enrollment ? (
        <form onSubmit={finishEnrollment} className="mt-5 grid gap-5 border-t border-line pt-5 md:grid-cols-[240px_1fr]">
          <div className="flex justify-center rounded-(--radius-sm) bg-white p-2">
            <Image
              src={enrollment.qrCode}
              alt={t("settings.mfa.qrAlt")}
              width={224}
              height={224}
              unoptimized
            />
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="settings-totp-secret">{t("settings.mfa.manualKey")}</Label>
              <Input
                id="settings-totp-secret"
                value={enrollment.secret}
                readOnly
                spellCheck={false}
                className="font-mono tracking-wide"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <div>
              <Label htmlFor="settings-totp-code">{t("settings.mfa.codeLabel")}</Label>
              <Input
                id="settings-totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy}>{t("settings.mfa.verifyAndAdd")}</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEnrollment(null);
                  setCode("");
                  setError(null);
                }}
              >
                {t("settings.mfa.cancel")}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      <ul className="mt-5 divide-y divide-line border-t border-line">
        {factors.map((factor) => (
          <li key={factor.id} className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium">{factor.name}</p>
              <p className="text-[12px] text-muted">{t("settings.mfa.verified")}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || factors.length <= 1}
              title={factors.length <= 1 ? t("settings.mfa.addAnotherFirst") : undefined}
              onClick={() => setRemoveFactor(factor)}
            >
              {t("settings.mfa.remove")}
            </Button>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
        {t("settings.mfa.lostAll")}
      </p>

      <Dialog
        open={removeFactor !== null}
        onClose={() => setRemoveFactor(null)}
        title={t("settings.mfa.removeTitle")}
      >
        <p className="text-sm leading-relaxed">
          {removeBefore}
          <strong>{removeFactor?.name}</strong>
          {removeAfter}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setRemoveFactor(null)}>
            {t("settings.mfa.cancel")}
          </Button>
          <Button type="button" variant="danger" loading={busy} onClick={confirmRemoval}>
            {t("settings.mfa.removeButton")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
