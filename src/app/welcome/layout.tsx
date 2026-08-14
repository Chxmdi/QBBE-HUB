import { ToastProvider } from "@/components/ui/toast";

/**
 * Onboarding renders outside the workspace shell — a focused first-run
 * surface without sidebar or top bar (§10.18).
 */
export default function WelcomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ToastProvider>{children}</ToastProvider>;
}
