"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function AccountInactivePage() {
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
      setError("Could not sign out. Try again.");
      return;
    }
    router.replace("/sign-in");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <div className="card space-y-3 p-6 text-center">
        <h1 className="text-[18px] font-semibold">This account is inactive</h1>
        <p className="text-[13.5px] text-muted">
          An administrator deactivated this membership. You can still sign out.
          Ask a Workspace Admin if you need access restored.
        </p>
        {error ? (
          <p role="alert" className="text-[13px] text-danger-fg">
            {error}
          </p>
        ) : null}
        <Button onClick={signOut} loading={signingOut} className="w-full">
          Sign out
        </Button>
      </div>
    </main>
  );
}
