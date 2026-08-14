import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  owner: "Primary Owner",
  admin: "Workspace Admin",
  staff: "Staff",
  volunteer: "Volunteer",
  guest: "Read-only guest",
};

export default async function WelcomePage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("user_profile")
    .select("onboarded_at")
    .eq("id", session.userId)
    .maybeSingle();

  // Already set up — never trap someone in onboarding.
  if (profile?.onboarded_at) redirect("/");

  return (
    <OnboardingFlow
      initialName={session.profile.full_name}
      initialTitle={session.profile.title}
      role={ROLE_LABELS[session.role] ?? session.role}
    />
  );
}
