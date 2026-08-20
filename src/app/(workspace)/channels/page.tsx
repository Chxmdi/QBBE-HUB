import type { Metadata } from "next";
import Link from "next/link";
import { Hash, Lock, Megaphone, MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AnnouncementComposeDialog } from "@/features/announcements/components/announcement-compose-dialog";
import { ChannelCreateDialog } from "@/features/channels/components/channel-create-dialog";
import { JoinChannelButton } from "@/features/channels/components/join-channel-button";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Channel } from "@/types/entities";

export const metadata: Metadata = { title: "Channels" };
export const dynamic = "force-dynamic";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: channels }, { data: myMemberships }] = await Promise.all([
    supabase
      .from("channel")
      .select(
        "id, name, slug, type, privacy, purpose, topic, owner_id, program_id, project_id, posting_policy, reply_policy, is_mandatory, archived_at, created_at",
      )
      .is("archived_at", null)
      .order("is_mandatory", { ascending: false })
      .order("name"),
    supabase
      .from("channel_member")
      .select("channel_id")
      .eq("user_id", session.userId),
  ]);

  const memberIds = new Set((myMemberships ?? []).map((m) => m.channel_id as string));
  const channelList = (channels ?? []) as unknown as Channel[];
  const mine = channelList.filter((c) => memberIds.has(c.id));
  const discoverable = channelList.filter((c) => !memberIds.has(c.id));

  function ChannelRow({ channel, joined }: { channel: Channel; joined: boolean }) {
    return (
      <li className="interactive-row flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-muted" aria-hidden>
          {channel.type === "announcements" ? (
            <Megaphone className="size-4" />
          ) : channel.privacy === "private" ? (
            <Lock className="size-4" />
          ) : (
            <Hash className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <Link
            href={`/channels/${channel.id}`}
            className="text-[14px] font-medium hover:text-brand-fg"
          >
            {channel.slug}
          </Link>
          {channel.purpose ? (
            <p className="meta truncate">{channel.purpose}</p>
          ) : null}
        </div>
        {channel.is_mandatory ? <Badge tone="brand">Mandatory</Badge> : null}
        {channel.privacy === "private" ? <Badge tone="neutral">Private</Badge> : null}
        {channel.posting_policy !== "everyone" ? (
          <Badge tone="accent">Restricted posting</Badge>
        ) : null}
        {!joined ? <JoinChannelButton channelId={channel.id} /> : null}
      </li>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Communication"
        title="Channels"
        description="Team communication that stays close to the work. Public channels are open to every member; private channels are membership-only."
        actions={
          <>
            {session.isAdmin ? <AnnouncementComposeDialog defaultOpen={params.create === "announcement"} /> : null}
            {session.isStaff ? (
              <ChannelCreateDialog defaultOpen={params.create === "1"} />
            ) : null}
          </>
        }
      />

      <div className="space-y-8">
        <section aria-labelledby="my-channels">
          <h2 id="my-channels" className="section-heading mb-3">
            Your channels
          </h2>
          {mine.length === 0 ? (
            <EmptyState
              icon={<MessagesSquare />}
              title="You haven't joined any channels"
              description="Browse the directory below and join the conversations relevant to your work."
            />
          ) : (
            <ul className="card divide-y divide-line">
              {mine.map((channel) => (
                <ChannelRow key={channel.id} channel={channel} joined />
              ))}
            </ul>
          )}
        </section>

        {discoverable.length > 0 ? (
          <section aria-labelledby="directory">
            <h2 id="directory" className="section-heading mb-3">
              Channel directory
            </h2>
            <ul className="card divide-y divide-line">
              {discoverable.map((channel) => (
                <ChannelRow key={channel.id} channel={channel} joined={false} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
