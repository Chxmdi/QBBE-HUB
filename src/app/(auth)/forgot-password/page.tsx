import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/features/onboarding/components/password-recovery-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.recovery.requestTitle") };
}
export default function ForgotPasswordPage() {
  return <PasswordRecoveryForm mode="request" />;
}
