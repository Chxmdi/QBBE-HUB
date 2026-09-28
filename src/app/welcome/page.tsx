import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";
import { requireSession } from "@/lib/auth";
import type { MessageKey } from "@/lib/i18n/translate";
import { getT } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("onboarding.title") };
}
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, MessageKey> = {
  owner: "onboarding.roles.owner",
  admin: "onboarding.roles.admin",
  staff: "onboarding.roles.staff",
  volunteer: "onboarding.roles.volunteer",
  guest: "onboarding.roles.guest",
};

export default async function WelcomePage() {
  const session = await requireSession();
  const t = await getT();
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
      role={ROLE_LABELS[session.role] ? t(ROLE_LABELS[session.role]) : session.role}
    />
  );
}
