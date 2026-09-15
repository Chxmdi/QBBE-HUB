import { PasswordRecoveryForm } from "@/features/onboarding/components/password-recovery-form";

export const metadata = { title: "Recover account" };
export default function ForgotPasswordPage() {
  return <PasswordRecoveryForm mode="request" />;
}
