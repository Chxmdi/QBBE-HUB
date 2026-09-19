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
    setFactors(verifiedTotpFactors(data.all));
  }

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCode("");
    const supabase = createSupabaseBrowserClient();
    const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(mfaErrorMessage(listError.message));
      setBusy(false);
      return;
    }

    for (const factorId of unverifiedTotpFactorIds(existing.all)) {
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
      if (removeError) {
        setError(mfaErrorMessage(removeError.message));
        setBusy(false);
        return;
      }
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `QBBE Hub authenticator ${factors.length + 1}`,
      issuer: "QBBE Hub",
    });
    setBusy(false);
    if (enrollError) {
      setError(mfaErrorMessage(enrollError.message));
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
      setError("Enter the six-digit code from your authenticator app.");
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
      setError(mfaErrorMessage(verifyError.message));
      setBusy(false);
      return;
    }

    await recordMfaSecurityEvent("mfa_enrollment_completed");
    try {
      await reloadFactors();
      setEnrollment(null);
      setCode("");
      setNotice("Authenticator added.");
    } catch (reloadError) {
      setError(mfaErrorMessage((reloadError as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    if (!removeFactor) return;
    if (factors.length <= 1) {
      setRemoveFactor(null);
      setError("Administrators must keep at least one verified authenticator.");
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
      setError(mfaErrorMessage(removeError.message));
      setBusy(false);
      setRemoveFactor(null);
      return;
    }

    await supabase.auth.refreshSession();
    await recordMfaSecurityEvent("mfa_factor_removed");
    try {
      await reloadFactors();
      setNotice("Authenticator removed.");
    } catch (reloadError) {
      setError(mfaErrorMessage((reloadError as Error).message));
    } finally {
      setBusy(false);
      setRemoveFactor(null);
    }
  }

  return (
    <section className="card mt-6 p-5" aria-labelledby="mfa-settings-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="mfa-settings-heading" className="text-base font-semibold">
            Multi-factor authentication
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
            Owners and administrators must verify an authenticator before privileged
            work. Keep a second authenticator available so a lost device does not
            require operator recovery.
          </p>
        </div>
        {!enrollment ? (
          <Button type="button" variant="secondary" onClick={startEnrollment} loading={busy}>
            Add authenticator
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
              alt="QR code for the new QBBE Hub authenticator"
              width={224}
              height={224}
              unoptimized
            />
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="settings-totp-secret">Manual setup key</Label>
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
              <Label htmlFor="settings-totp-code">Six-digit code</Label>
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
              <Button type="submit" loading={busy}>Verify and add</Button>
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
                Cancel
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
              <p className="text-[12px] text-muted">Verified authenticator</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || factors.length <= 1}
              title={factors.length <= 1 ? "Add another authenticator before removing this one." : undefined}
              onClick={() => setRemoveFactor(factor)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
        Lost every authenticator? Contact the QBBE credential custodian. A reset
        requires identity verification, a second authorized operator, and an audit entry.
      </p>

      <Dialog
        open={removeFactor !== null}
        onClose={() => setRemoveFactor(null)}
        title="Remove authenticator"
      >
        <p className="text-sm leading-relaxed">
          Remove <strong>{removeFactor?.name}</strong>? You will need another verified
          authenticator the next time QBBE Hub challenges this account.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setRemoveFactor(null)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" loading={busy} onClick={confirmRemoval}>
            Remove authenticator
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
