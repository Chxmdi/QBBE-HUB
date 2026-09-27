"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";

export function PasswordRecoveryForm({ mode }: { mode: "request" | "reset" }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    setBusy(true);
    try {
      const db = createSupabaseBrowserClient();
      if (mode === "request") {
        const { error: sendError } = await db.auth.resetPasswordForEmail(String(data.get("email")).trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        // Provider-side authentication rate limits apply. Never reveal account existence.
        if (sendError) throw new Error(t("auth.recovery.requestFailed"));
      } else {
        const password = String(data.get("password"));
        if (password !== data.get("confirm")) throw new Error(t("auth.recovery.mismatch"));
        const { error: updateError } = await db.auth.updateUser({ password });
        if (updateError) throw new Error(t("auth.recovery.updateFailed"));
        await db.auth.signOut();
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("auth.recovery.failed"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="card space-y-4 p-6">
    <h2 className="text-lg font-semibold">{mode === "request" ? t("auth.recovery.requestHeading") : t("auth.recovery.resetHeading")}</h2>
    {done ? <p role="status">{mode === "request"
      ? t("auth.recovery.requestDone")
      : t("auth.recovery.resetDone")}</p>
      : <form onSubmit={submit} className="space-y-4">
        {mode === "request" ? <div>
          <Label htmlFor="recovery-email">{t("common.email")}</Label>
          <Input id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={254} />
        </div> : <>
          <p className="text-sm text-muted">{t("auth.recovery.passwordRules")}</p>
          <div><Label htmlFor="new-password">{t("auth.recovery.newPassword")}</Label>
            <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></div>
          <div><Label htmlFor="confirm-password">{t("auth.recovery.confirmPassword")}</Label>
            <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></div>
        </>}
        {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
        <Button type="submit" loading={busy} disabled={busy} className="w-full">{mode === "request" ? t("auth.recovery.sendLink") : t("auth.recovery.savePassword")}</Button>
      </form>}
    <Link className="inline-block text-sm text-brand-fg hover:underline" href="/sign-in">{t("common.backToSignIn")}</Link>
  </div>;
}
