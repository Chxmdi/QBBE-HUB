"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * "Continue with Google" (V2-9). Renders nothing unless the deploy sets
 * NEXT_PUBLIC_GOOGLE_SIGN_IN=on, which it does only after the provider is set
 * up (docs/runbooks/google-sign-in.md). Integration places it on the sign-in
 * page. The label is passed in, so the sign-in page's own catalogue owns it.
 */
export function GoogleSignInButton({ label, next = "/" }: { label: string; next?: string }) {
  const [pending, setPending] = useState(false);
  if (process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN !== "on") return null;
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      loading={pending}
      onClick={async () => {
        setPending(true);
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
        const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) setPending(false);
      }}
    >
      {label}
    </Button>
  );
}
