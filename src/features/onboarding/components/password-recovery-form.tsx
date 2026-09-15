"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function PasswordRecoveryForm({ mode }: { mode: "request" | "reset" }) {
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
        if (sendError) throw new Error("Could not request recovery. Wait a moment and try again.");
      } else {
        const password = String(data.get("password"));
        if (password !== data.get("confirm")) throw new Error("The passwords do not match.");
        const { error: updateError } = await db.auth.updateUser({ password });
        if (updateError) throw new Error("Could not change your password. Check the password requirements or request a new recovery link.");
        await db.auth.signOut();
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete recovery. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="card space-y-4 p-6">
    <h2 className="text-lg font-semibold">{mode === "request" ? "Recover your account" : "Choose a new password"}</h2>
    {done ? <p role="status">{mode === "request"
      ? "If this address belongs to an account, a recovery link will arrive shortly. Open it in this browser."
      : "Your password has been changed. Sign in with your new password."}</p>
      : <form onSubmit={submit} className="space-y-4">
        {mode === "request" ? <div>
          <Label htmlFor="recovery-email">Email</Label>
          <Input id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={254} />
        </div> : <>
          <p className="text-sm text-muted">Use at least 12 characters. Your workspace may require additional password safeguards.</p>
          <div><Label htmlFor="new-password">New password</Label>
            <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></div>
          <div><Label htmlFor="confirm-password">Confirm password</Label>
            <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></div>
        </>}
        {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
        <Button type="submit" loading={busy} disabled={busy} className="w-full">{mode === "request" ? "Send recovery link" : "Save password"}</Button>
      </form>}
    <Link className="inline-block text-sm text-brand-fg hover:underline" href="/sign-in">Back to sign in</Link>
  </div>;
}
