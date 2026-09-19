import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MfaFlow } from "./mfa-flow";
import { requiresAdministratorMfa, verifiedTotpFactors } from "@/features/auth/mfa";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Multi-factor authentication" };

export default async function MfaPage() {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/");

  const supabase = await createSupabaseServerClient();
  const [assuranceResult, factorResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (
    assuranceResult.data &&
    factorResult.data &&
    !requiresAdministratorMfa(
      session.isAdmin,
      assuranceResult.data.currentLevel,
      assuranceResult.data.nextLevel,
      verifiedTotpFactors(factorResult.data.all).length > 0,
    )
  ) {
    redirect("/");
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Protect your administrator account</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          QBBE Hub requires an authenticator code for owners and administrators.
        </p>
      </div>
      <Suspense fallback={<div className="card p-6 text-center text-sm">Loading security check…</div>}>
        <MfaFlow />
      </Suspense>
    </div>
  );
}
