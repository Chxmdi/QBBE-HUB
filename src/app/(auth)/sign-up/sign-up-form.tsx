"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
} from "@/features/auth/password-rules";

export interface SignUpInvitation {
  token: string;
  email: string;
  organizationName: string;
}

/**
 * With an invitation, the address is the invited one and cannot be changed:
 * the token only works for it, and `app.handle_new_user` checks both. Without
 * one, this form is only reachable while no workspace exists (the first
 * account becomes the owner).
 */
export function SignUpForm({ invitation }: { invitation: SignUpInvitation | null }) {
  const t = useT();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(invitation?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password);
    if (problem) {
      setError(t(`auth.password.${problem}`, { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }));
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: invitation?.email ?? email,
        password,
        options: {
          data: invitation
            ? { full_name: fullName, invite_token: invitation.token }
            : { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (signUpError) {
        // The database refuses an unusable invitation by aborting the insert,
        // which Supabase Auth reports as a generic "Database error saving new
        // user". With an invitation, that means the link; without one (the very
        // first account) it can only be a fault, so it is not blamed on a link.
        // Auth's own refusal of a weak password is shown in the reader's language.
        const databaseRefused = /database error/i.test(signUpError.message);
        setError(
          databaseRefused
            ? invitation
              ? t("auth.signUp.inviteRejected")
              : t("auth.signUp.failed")
            : signUpError.code === "weak_password"
              ? t("auth.password.hint", { min: MIN_PASSWORD_LENGTH })
              : signUpError.message,
        );
        return;
      }
      if (data.session) {
        router.push("/");
        router.refresh();
      } else {
        // Email confirmation is enabled on the Supabase project; the membership
        // is granted when the link in that email is followed.
        setNeedsConfirmation(true);
      }
    } catch {
      setError(t("ui.actionUnreachable"));
    } finally {
      setLoading(false);
    }
  }

  if (needsConfirmation) {
    return (
      <div className="card space-y-3 p-6 text-center">
        <p className="text-[15px] font-medium">{t("auth.signUp.checkEmail")}</p>
        <p className="text-[13.5px] text-muted">
          {t("auth.signUp.confirmationSent", { email: invitation?.email ?? email })}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-6">
      {invitation ? (
        <p className="text-[13.5px] font-medium">
          {t("auth.signUp.invitedTo", { organization: invitation.organizationName })}
        </p>
      ) : null}
      <div>
        <Label htmlFor="fullName">{t("auth.signUp.fullName")}</Label>
        <Input
          id="fullName"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="email">{t("common.email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          readOnly={Boolean(invitation)}
          aria-describedby={invitation ? "email-locked" : undefined}
          value={invitation?.email ?? email}
          onChange={(e) => setEmail(e.target.value)}
          className={invitation ? "bg-surface-soft" : undefined}
        />
        {invitation ? (
          <p id="email-locked" className="mt-1 text-[12.5px] text-muted">
            {t("auth.signUp.emailLocked")}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="password">{t("common.password")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          aria-describedby="password-hint"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FieldHint id="password-hint">
          {t("auth.password.hint", { min: MIN_PASSWORD_LENGTH })}
        </FieldHint>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <p className="text-[12.5px] text-muted">
        {(() => {
          // The sentence is translated whole; the link sits where {link} is.
          const [before, after] = t("privacy.acknowledge", { link: "\u0000" }).split("\u0000");
          return (
            <>
              {before}
              <Link href="/privacy" className="font-medium text-brand-fg underline">
                {t("privacy.linkInline")}
              </Link>
              {after}
            </>
          );
        })()}
      </p>
      <Button type="submit" loading={loading} className="w-full">
        {t("auth.signUp.submit")}
      </Button>
      <p className="text-center text-[13px] text-muted">
        {t("auth.signUp.haveAccount")}{" "}
        <Link href="/sign-in" className="font-medium text-brand-fg hover:underline">
          {t("auth.signUp.signIn")}
        </Link>
      </p>
    </form>
  );
}
