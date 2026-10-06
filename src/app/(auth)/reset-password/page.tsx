import Link from "next/link";
import { PasswordRecoveryForm } from "@/features/onboarding/components/password-recovery-form";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
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
  return <PasswordRecoveryForm mode="reset" />;
}
