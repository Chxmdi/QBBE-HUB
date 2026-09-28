import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Hash, Lock, Megaphone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Suspense } from "react";
import { ChannelView } from "@/features/channels/components/channel-view";
import { ChannelAdminMenu } from "@/features/channels/components/channel-admin-menu";
import { AddChannelMemberDialog } from "@/features/channels/components/add-channel-member";
import { LeaveChannelButton } from "@/features/channels/components/leave-channel-button";
import {
  PinnedResources,
  type PinnedResourceRow,
} from "@/features/channels/components/pinned-resources";
import { JoinChannelButton } from "@/features/channels/components/join-channel-button";
import { AnnouncementComposeDialog } from "@/features/announcements/components/announcement-compose-dialog";
import { CHANNEL_HISTORY_PAGE_SIZE } from "@/features/channels/history";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Channel, Message } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("channels.channelTitle") };
}
export const dynamic = "force-dynamic";

const MESSAGE_SELECT =
  "id, channel_id, conversation_id, thread_root_id, author_id, body, is_system, created_at, edited_at, deleted_at, " +
  "author:author_id(id, full_name, email, avatar_url, title, timezone), reactions:message_reaction(message_id, user_id, emoji)";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const t = await getT();
  const { id } = await params;
  const supabase = await createSupabasePageClient();

  const { data: channelRow } = await supabase
    .from("channel")
    .select(
      "id, name, slug, type, privacy, purpose, topic, owner_id, program_id, project_id, posting_policy, reply_policy, is_mandatory, archived_at, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  // RLS: private channels the user cannot access simply do not exist here.
  if (!channelRow) notFound();
  const channel = channelRow as unknown as Channel;

  const [
    { data: membership },
    { count: memberCount },
    { data: messages },
    { data: pins },
    { data: orgMembers },
    { data: grants },
    { data: preference },
  ] = await Promise.all([
    supabase
      .from("channel_member")
      .select("role, membership_source")
      .eq("channel_id", id)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase
      .from("channel_member")
      .select("user_id", { count: "exact", head: true })
      .eq("channel_id", id),
    supabase
      .from("message")
      .select(MESSAGE_SELECT)
      .eq("channel_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CHANNEL_HISTORY_PAGE_SIZE),
    supabase
      .from("pinned_resource")
      .select("id, title, url, message_id")
      .eq("channel_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("organization_membership")
      .select("user_id, user_profile:user_id(id, full_name)")
      .eq("status", "active"),
    supabase
      .from("channel_access_grant")
      .select(
        "id, source, created_by, user:user_id(full_name), team:source_team_id(name), grantor:created_by(full_name)",
      )
      .eq("channel_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("notification_preference")
      .select("muted_thread_ids")
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);

  const isMember = Boolean(membership);
  const initialMessages = [...((messages ?? []) as unknown as Message[])].reverse();
  const { data: saved } = initialMessages.length
    ? await supabase
        .from("saved_message")
        .select("message_id")
        .eq("user_id", session.userId)
        .in("message_id", initialMessages.map((message) => message.id))
    : { data: [] as { message_id: string }[] };
  const canPost =
    isMember &&
    !channel.archived_at &&
    (channel.posting_policy === "everyone"
      ? true
      : channel.posting_policy === "staff"
        ? session.isStaff
        : session.isAdmin);

  const postDisabledHint = !isMember
    ? t("channels.postHint.join")
    : channel.archived_at
      ? t("channels.postHint.archived")
      : channel.posting_policy === "admins"
        ? t("channels.postHint.admins")
        : t("channels.postHint.staff");

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] flex-col md:-mx-8">
      {/* Channel header (P0-LINK-01: links back to source record) */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-3 md:px-6">
        <span className="text-muted" aria-hidden>
          {channel.type === "announcements" ? (
            <Megaphone className="size-4.5" />
          ) : channel.privacy === "private" ? (
            <Lock className="size-4.5" />
          ) : (
            <Hash className="size-4.5" />
          )}
        </span>
        <h1 className="text-[16px] font-semibold">{channel.slug}</h1>
        {channel.is_mandatory ? <Badge tone="brand">{t("channels.badges.mandatory")}</Badge> : null}
        {channel.posting_policy !== "everyone" ? (
          <Badge tone="accent">{t("channels.badges.restrictedPosting")}</Badge>
        ) : null}
        {channel.project_id ? (
          <Link
            href={`/projects/${channel.project_id}`}
            className="text-[12.5px] font-medium text-brand-fg hover:underline"
          >
            {t("channels.viewProject")}
          </Link>
        ) : null}
        {channel.program_id ? (
          <Link
            href={`/programs/${channel.program_id}`}
            className="text-[12.5px] font-medium text-brand-fg hover:underline"
          >
            {t("channels.viewProgram")}
          </Link>
        ) : null}
        <span className="meta ml-auto flex items-center gap-1">
          <Users className="size-3.5" aria-hidden />
          {t(memberCount === 1 ? "channels.memberOne" : "channels.memberOther", {
            count: memberCount ?? 0,
          })}
        </span>
        {channel.type === "announcements" && session.isAdmin ? (
          <AnnouncementComposeDialog />
        ) : null}
        {!isMember && channel.privacy === "public" && !channel.archived_at ? (
          <JoinChannelButton channelId={channel.id} />
        ) : null}
        {session.isAdmin || channel.owner_id === session.userId ? (
          <>
            <AddChannelMemberDialog
              channelId={channel.id}
              people={((orgMembers ?? []) as unknown as { user_id: string; user_profile: { full_name: string } | null }[])
                .filter((m) => m.user_profile)
                .map((m) => ({ id: m.user_id, label: m.user_profile!.full_name }))}
            />
            <ChannelAdminMenu
              channelId={channel.id}
              archived={Boolean(channel.archived_at)}
            />
          </>
        ) : null}
        {isMember && membership?.membership_source !== "manual" ? (
          <Badge tone="neutral">
            {membership?.membership_source === "team"
              ? t("channels.badges.teamAccess")
              : t("channels.badges.managedAccess")}
          </Badge>
        ) : null}
        {isMember && !channel.is_mandatory && membership?.membership_source === "manual" ? (
          <LeaveChannelButton channelId={channel.id} />
        ) : null}
      </header>
      {channel.archived_at ? (
        <p
          role="status"
          className="border-b border-line bg-surface-soft px-4 py-1.5 text-center text-[12.5px] text-muted md:px-6"
        >
          {t("channels.archivedBanner")}
        </p>
      ) : null}
      {channel.purpose ? (
        <p className="border-b border-line bg-surface-soft/50 px-4 py-1.5 text-[12.5px] text-muted md:px-6">
          {channel.purpose}
        </p>
      ) : null}

      <ChannelAccess grants={(grants ?? []) as unknown as ChannelGrant[]} t={t} />

      <PinnedResources
        channelId={channel.id}
        resources={(pins ?? []) as PinnedResourceRow[]}
        canManage={session.isStaff && isMember}
      />

      <Suspense fallback={<p className="px-4 py-6 text-[13px] text-muted">{t("channels.loadingMessages")}</p>}>
        <ChannelView
          channelId={channel.id}
          currentUserId={session.userId}
          canPost={canPost}
          postDisabledHint={postDisabledHint}
          replyPolicy={channel.reply_policy}
          initialMessages={initialMessages}
          initialSavedMessageIds={(saved ?? []).map((row) => row.message_id as string)}
          isStaff={session.isStaff}
          mutedThreadIds={((preference?.muted_thread_ids as string[] | null) ?? []).filter(Boolean)}
        />
      </Suspense>
    </div>
  );
}

interface ChannelGrant {
  id: string;
  source: string;
  user: { full_name: string } | null;
  team: { name: string } | null;
  grantor: { full_name: string } | null;
}

const GRANT_SOURCES = [
  "direct",
  "team",
  "program",
  "project",
  "event",
  "mandatory",
  "legacy",
] as const;

function grantSourceLabel(source: string, t: TranslateFn): string {
  return (GRANT_SOURCES as readonly string[]).includes(source)
    ? t(`channels.access.source.${source as (typeof GRANT_SOURCES)[number]}`)
    : source;
}

function ChannelAccess({ grants, t }: { grants: ChannelGrant[]; t: TranslateFn }) {
  if (grants.length === 0) return null;
  return (
    <details className="border-b border-line bg-surface px-4 py-2 md:px-6">
      <summary className="cursor-pointer text-[13px] font-medium">
        {t("channels.access.summary", { count: grants.length })}
      </summary>
      <ul className="mt-2 space-y-1 pb-1">
        {grants.map((grant) => (
          <li key={grant.id} className="text-[12.5px] text-muted">
            <span className="text-ink">{grant.user?.full_name ?? t("channels.access.member")}</span>
            {" · "}
            {grantSourceLabel(grant.source, t)}
            {grant.team?.name ? ` · ${grant.team.name}` : ""}
            {" · "}
            {t("channels.access.grantedBy", {
              name: grant.grantor?.full_name ?? t("channels.access.theWorkspace"),
            })}
          </li>
        ))}
      </ul>
    </details>
  );
}
