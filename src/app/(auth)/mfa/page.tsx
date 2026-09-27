import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MfaFlow } from "./mfa-flow";
import { requiresAdministratorMfa, verifiedTotpFactors } from "@/features/auth/mfa";
import { hasAccountantGrant } from "@/features/ledger/services/ledger.access";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Multi-factor authentication" };

export default async function MfaPage() {
  const session = await requireSession();
  // The external accountant (#154) opens the books only after MFA too.
  const isAccountant =
    !session.isAdmin && (await hasAccountantGrant(await createSupabasePageClient(), session));
  if (!session.isAdmin && !isAccountant) redirect("/");
  const mfaRequired = session.isAdmin || isAccountant;

  const supabase = await createSupabaseServerClient();
  const [assuranceResult, factorResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (
    assuranceResult.data &&
    factorResult.data &&
    !requiresAdministratorMfa(
      mfaRequired,
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
        <h2 className="text-lg font-semibold">
          {isAccountant ? "Protect your accountant access" : "Protect your administrator account"}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {isAccountant
            ? "QBBE Hub requires an authenticator code before the books open."
            : "QBBE Hub requires an authenticator code for owners and administrators."}
        </p>
      </div>
      <Suspense fallback={<div className="card p-6 text-center text-sm">Loading security check…</div>}>
        <MfaFlow />
      </Suspense>
    </div>
  );
}
