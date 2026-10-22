import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MfaFlow } from "./mfa-flow";
import { requiresAdministratorMfa, verifiedTotpFactors } from "@/features/auth/mfa";
import { hasAccountantGrant, hasLedgerReaderGrant } from "@/features/ledger/services/ledger.access";
import { requireSession } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.mfa.title") };
}

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await requireSession();
  const nextParam = (await searchParams).next;
  const next = safeRedirectPath(Array.isArray(nextParam) ? nextParam[0] : nextParam);
  const t = await getT();
  // The external accountant (#154) and staff named ledger readers open the
  // books only after MFA too.
  const pageClient = await createSupabasePageClient();
  const isAccountant = !session.isAdmin && !session.isStaff && (await hasAccountantGrant(pageClient, session));
  const isLedgerReader =
    !session.isAdmin && session.isStaff && (await hasLedgerReaderGrant(pageClient, session));

  const supabase = await createSupabaseServerClient();
  const [assuranceResult, factorResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const hasFactor = verifiedTotpFactors(factorResult.data?.all ?? [], t).length > 0;
  // Anyone who set up an authenticator verifies here when something needs it
  // (changing a forgotten password needs a verified session), not only the
  // owners, admins, accountants and ledger readers who must.
  const isMember = !session.isAdmin && !isAccountant && !isLedgerReader;
  if (isMember && !hasFactor) redirect("/");
  const mfaRequired = session.isAdmin || isAccountant || isLedgerReader || hasFactor;
  if (
    assuranceResult.data &&
    factorResult.data &&
    !requiresAdministratorMfa(
      mfaRequired,
      assuranceResult.data.currentLevel,
      assuranceResult.data.nextLevel,
      hasFactor,
    )
  ) {
    // Already verified: go where the person was headed.
    redirect(next.startsWith("/mfa") ? "/" : next);
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold">
          {isMember
            ? t("auth.mfa.memberHeading")
            : isAccountant
              ? t("auth.mfa.accountantHeading")
              : isLedgerReader
                ? t("auth.mfa.ledgerReaderHeading")
                : t("auth.mfa.adminHeading")}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {isMember
            ? t("auth.mfa.memberBody")
            : isAccountant
              ? t("auth.mfa.accountantBody")
              : isLedgerReader
                ? t("auth.mfa.ledgerReaderBody")
                : t("auth.mfa.adminBody")}
        </p>
      </div>
      <Suspense fallback={<div className="card p-6 text-center text-sm">{t("auth.mfa.loading")}</div>}>
        <MfaFlow />
      </Suspense>
    </div>
  );
}
