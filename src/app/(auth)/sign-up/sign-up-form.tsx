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

export function SignUpForm() {
  const t = useT();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
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
    const supabase = createSupabaseBrowserClient();
    const { data: allowed, error: allowError } = await supabase.rpc("signup_allowed", {
      p_email: email.trim(),
    });
    if (allowError) {
      setLoading(false);
      setError(t("auth.signUp.checkFailed"));
      return;
    }
    if (allowed !== true) {
      setLoading(false);
      setError(t("auth.signUp.inviteOnly"));
      return;
    }
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (signUpError) {
      // Auth's own refusal of a weak password, in the reader's language.
      setError(
        signUpError.code === "weak_password"
          ? t("auth.password.hint", { min: MIN_PASSWORD_LENGTH })
          : signUpError.message,
      );
      return;
    }
    if (data.session) {
      router.push("/");
      router.refresh();
    } else {
      // Email confirmation is enabled on the Supabase project.
      setNeedsConfirmation(true);
    }
  }

  if (needsConfirmation) {
    return (
      <div className="card space-y-3 p-6 text-center">
        <p className="text-[15px] font-medium">{t("auth.signUp.checkEmail")}</p>
        <p className="text-[13.5px] text-muted">
          {t("auth.signUp.confirmationSent", { email })}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-6">
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
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
