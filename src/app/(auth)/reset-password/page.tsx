import Link from "next/link";
import { PasswordRecoveryForm } from "@/features/onboarding/components/password-recovery-form";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { hasVerifiedTotpFactor } from "@/features/auth/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.recovery.resetTitle") };
}
export default async function ResetPasswordPage() {
  const t = await getT();
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return <div className="card space-y-4 p-6">
    <p role="alert">{t("auth.recovery.sessionMissing")}</p>
    <Link href="/forgot-password" className="text-brand-fg hover:underline">{t("auth.recovery.requestNewLink")}</Link>
  </div>;
  // Changing the password of an account with an authenticator needs a
  // verified session; a recovery link alone gives an unverified one, and the
  // change failed with an error that sent people round in a loop. Verify
  // first, then come back here.
  const [assurance, factors] = await Promise.all([
    db.auth.mfa.getAuthenticatorAssuranceLevel(),
    db.auth.mfa.listFactors(),
  ]);
  if (hasVerifiedTotpFactor(factors.data?.all ?? []) && assurance.data?.currentLevel !== "aal2") {
    redirect("/mfa?next=%2Freset-password");
  }
  return <PasswordRecoveryForm mode="reset" />;
}
