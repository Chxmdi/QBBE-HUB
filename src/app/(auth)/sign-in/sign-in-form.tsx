"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { useT } from "@/lib/i18n/client";

function SignInFormInner() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Uncontrolled fields, read on submit: what a person types before the
  // page's scripts have run stays typed when React takes the form over.
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setError(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? t("auth.signIn.badCredentials")
          : signInError.message,
      );
      return;
    }
    router.push(safeRedirectPath(searchParams.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-6">
      <div>
        <Label htmlFor="email">{t("common.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div>
        <Label htmlFor="password">{t("common.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      {/* Disabled until the page can handle it, so a click is never lost. */}
      <Button type="submit" loading={loading} disabled={!hydrated} className="w-full">
        {t("auth.signIn.submit")}
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-brand-fg hover:underline">{t("auth.signIn.forgot")}</Link>
      </p>
      <p className="text-center text-[13px] text-muted">
        {t("auth.signIn.newHere")}{" "}
        <Link href="/sign-up" className="font-medium text-brand-fg hover:underline">
          {t("auth.signIn.createAccount")}
        </Link>
      </p>
    </form>
  );
}

export function SignInForm() {
  return (
    <Suspense>
      <SignInFormInner />
    </Suspense>
  );
}
