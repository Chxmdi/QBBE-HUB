"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { useT } from "@/lib/i18n/client";

function SignInFormInner() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={loading} className="w-full">
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
