import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.signUp.title") };
}

/**
 * Sign-up is by invitation link (SEC-001). The link's secret is checked here
 * only to show the right screen; the database checks it again, for the
 * address it was sent to, when the account is created.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const t = await getT();
  const { invite } = await searchParams;
  // A link pasted twice can arrive as ?invite=a&invite=a; the first one counts.
  const token = (Array.isArray(invite) ? invite[0] : invite)?.trim() ?? "";
  const supabase = await createSupabaseServerClient();

  if (token) {
    const { data, error } = await supabase.rpc("invitation_preview", { p_token: token });
    if (error) {
      // Not the link's fault: saying it is would send the person to ask for a
      // new one, which cancels the one they hold.
      return (
        <SignUpNotice
          title={t("auth.signUp.previewFailedTitle")}
          body={t("auth.signUp.previewFailedBody")}
        />
      );
    }
    const invitation = Array.isArray(data) ? data[0] : null;
    if (!invitation) {
      return <SignUpNotice title={t("auth.signUp.invalidTitle")} body={t("auth.signUp.invalidBody")} />;
    }
    return (
      <SignUpForm
        invitation={{
          token,
          email: invitation.email,
          organizationName: invitation.organization_name,
        }}
      />
    );
  }

  // Only the very first account, which creates the workspace and becomes its
  // owner, signs up without an invitation.
  const { data: bootstrapOpen } = await supabase.rpc("workspace_bootstrap_open");
  if (bootstrapOpen === true) return <SignUpForm invitation={null} />;

  return <SignUpNotice title={t("auth.signUp.inviteOnlyTitle")} body={t("auth.signUp.inviteOnlyBody")} />;
}

async function SignUpNotice({ title, body }: { title: string; body: string }) {
  const t = await getT();
  return (
    <div className="card space-y-3 p-6">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="text-[13.5px] text-muted">{body}</p>
      <Link
        href="/sign-in"
        className="inline-flex h-9.5 w-full items-center justify-center rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
      >
        {t("auth.signUp.goToSignIn")}
      </Link>
    </div>
  );
}
