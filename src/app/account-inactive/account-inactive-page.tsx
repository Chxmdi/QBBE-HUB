"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function AccountInactivePage() {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setSigningOut(false);
      setError(t("account.inactive.signOutFailed"));
      return;
    }
    router.replace("/sign-in");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <div className="card space-y-3 p-6 text-center">
        <h1 className="text-[18px] font-semibold">{t("account.inactive.heading")}</h1>
        <p className="text-[13.5px] text-muted">
          {t("account.inactive.body")}
        </p>
        {error ? (
          <p role="alert" className="text-[13px] text-danger-fg">
            {error}
          </p>
        ) : null}
        <Button onClick={signOut} loading={signingOut} className="w-full">
          {t("account.inactive.signOut")}
        </Button>
      </div>
    </main>
  );
}
