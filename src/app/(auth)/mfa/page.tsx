import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MfaFlow } from "./mfa-flow";
import { requiresAdministratorMfa, verifiedTotpFactors } from "@/features/auth/mfa";
import { hasAccountantGrant } from "@/features/ledger/services/ledger.access";
import { requireSession } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.mfa.title") };
}

export default async function MfaPage() {
  const session = await requireSession();
  const t = await getT();
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
      verifiedTotpFactors(factorResult.data.all, t).length > 0,
    )
  ) {
    redirect("/");
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold">
          {isAccountant ? t("auth.mfa.accountantHeading") : t("auth.mfa.adminHeading")}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {isAccountant ? t("auth.mfa.accountantBody") : t("auth.mfa.adminBody")}
        </p>
      </div>
      <Suspense fallback={<div className="card p-6 text-center text-sm">{t("auth.mfa.loading")}</div>}>
        <MfaFlow />
      </Suspense>
    </div>
  );
}
