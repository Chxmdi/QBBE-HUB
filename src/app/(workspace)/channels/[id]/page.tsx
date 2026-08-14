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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Channel, Message } from "@/types/entities";

export const metadata: Metadata = { title: "Channel" };
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
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

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
  ] = await Promise.all([
    supabase
      .from("channel_member")
      .select("role")
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
  ]);

  const isMember = Boolean(membership);
  const canPost =
    isMember &&
    !channel.archived_at &&
    (channel.posting_policy === "everyone"
      ? true
      : channel.posting_policy === "staff"
        ? session.isStaff
        : session.isAdmin);

  const postDisabledHint = !isMember
    ? "Join this channel to participate."
    : channel.archived_at
      ? "This channel is archived and read-only."
      : channel.posting_policy === "admins"
        ? "Posting here is limited to leadership and admins. You can reply in threads."
        : "Posting here is limited to staff.";

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
        {channel.is_mandatory ? <Badge tone="brand">Mandatory</Badge> : null}
        {channel.posting_policy !== "everyone" ? (
          <Badge tone="accent">Restricted posting</Badge>
        ) : null}
        {channel.project_id ? (
          <Link
            href={`/projects/${channel.project_id}`}
            className="text-[12.5px] font-medium text-brand-fg hover:underline"
          >
            View linked project →
          </Link>
        ) : null}
        {channel.program_id ? (
          <Link
            href={`/programs/${channel.program_id}`}
            className="text-[12.5px] font-medium text-brand-fg hover:underline"
          >
            View linked program →
          </Link>
        ) : null}
        <span className="meta ml-auto flex items-center gap-1">
          <Users className="size-3.5" aria-hidden />
          {memberCount ?? 0} members
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
        {isMember && !channel.is_mandatory ? (
          <LeaveChannelButton channelId={channel.id} />
        ) : null}
      </header>
      {channel.archived_at ? (
        <p
          role="status"
          className="border-b border-line bg-surface-soft px-4 py-1.5 text-center text-[12.5px] text-muted md:px-6"
        >
          This channel is archived. History stays searchable for members, but no
          new messages can be posted.
        </p>
      ) : null}
      {channel.purpose ? (
        <p className="border-b border-line bg-surface-soft/50 px-4 py-1.5 text-[12.5px] text-muted md:px-6">
          {channel.purpose}
        </p>
      ) : null}

      <PinnedResources
        channelId={channel.id}
        resources={(pins ?? []) as PinnedResourceRow[]}
        canManage={session.isStaff && isMember}
      />

      <Suspense fallback={<p className="px-4 py-6 text-[13px] text-muted">Loading messages…</p>}>
        <ChannelView
          channelId={channel.id}
          currentUserId={session.userId}
          canPost={canPost}
          postDisabledHint={postDisabledHint}
          replyPolicy={channel.reply_policy}
          initialMessages={[...((messages ?? []) as unknown as Message[])].reverse()}
          isStaff={session.isStaff}
        />
      </Suspense>
    </div>
  );
}
