import Link from "next/link";
import { PasswordRecoveryForm } from "@/features/onboarding/components/password-recovery-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Reset password" };
export default async function ResetPasswordPage() {
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return <div className="card space-y-4 p-6">
    <p role="alert">Your recovery session is missing or has expired.</p>
    <Link href="/forgot-password" className="text-brand-fg hover:underline">Request a new recovery link</Link>
  </div>;
  return <PasswordRecoveryForm mode="reset" />;
}
