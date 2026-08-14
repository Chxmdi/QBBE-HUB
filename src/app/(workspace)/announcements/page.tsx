import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Megaphone, Pin } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AcknowledgeButton } from "@/features/announcements/components/acknowledge-button";
import { AnnouncementComposeDialog } from "@/features/announcements/components/announcement-compose-dialog";
import { ProgressBar } from "@/features/dashboard/components/charts";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatDate, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Announcements" };
export const dynamic = "force-dynamic";

interface AnnouncementRow {
  id: string;
  title: string;
  priority: "normal" | "important" | "critical";
  requires_ack: boolean;
  ack_deadline: string | null;
  publish_at: string;
  expires_at: string | null;
  created_at: string;
  message: { id: string; body: string; channel_id: string | null } | null;
  author: { full_name: string; avatar_url: string | null } | null;
}

const PRIORITY_TONE = {
  normal: "neutral",
  important: "accent",
  critical: "danger",
} as const;

/**
 * Announcement index (§10.7): active/pinned items first, then history.
 * Expired announcements leave the attention surface but stay readable and
 * searchable per retention policy.
 */
export default async function AnnouncementsPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();

  const [{ data: announcements }, { data: myAcks }, { count: totalMembers }] =
    await Promise.all([
      supabase
        .from("announcement")
        .select(
          "id, title, priority, requires_ack, ack_deadline, publish_at, expires_at, created_at, " +
            "message:message_id(id, body, channel_id), author:created_by(full_name, avatar_url)",
        )
        .lte("publish_at", now)
        .order("publish_at", { ascending: false })
        .limit(100),
      supabase
        .from("announcement_acknowledgment")
        .select("announcement_id")
        .eq("user_id", session.userId),
      supabase
        .from("organization_membership")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
    ]);

  const rows = (announcements ?? []) as unknown as AnnouncementRow[];
  const acked = new Set((myAcks ?? []).map((a) => a.announcement_id as string));

  // Admins see aggregate acknowledgment progress (P0-ANN-04).
  const ackCounts = new Map<string, number>();
  if (session.isAdmin && rows.length > 0) {
    const { data: allAcks } = await supabase
      .from("announcement_acknowledgment")
      .select("announcement_id")
      .in(
        "announcement_id",
        rows.map((r) => r.id),
      );
    for (const ack of allAcks ?? []) {
      const key = ack.announcement_id as string;
      ackCounts.set(key, (ackCounts.get(key) ?? 0) + 1);
    }
  }

  const isExpired = (a: AnnouncementRow) =>
    Boolean(a.expires_at && new Date(a.expires_at) < new Date());

  const active = rows.filter((a) => !isExpired(a));
  const history = rows.filter(isExpired);

  function AnnouncementCard({
    announcement,
    muted = false,
  }: {
    announcement: AnnouncementRow;
    muted?: boolean;
  }) {
    const acknowledged = acked.has(announcement.id);
    const needsAck = announcement.requires_ack && !acknowledged && !muted;
    const ackCount = ackCounts.get(announcement.id) ?? 0;

    return (
      <article
        className={cn(
          "card p-5",
          // Subtle warm container, never a giant red alert block (§10.7).
          needsAck && "border-brand/30 bg-brand-soft/40",
          muted && "opacity-75",
        )}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Megaphone className="size-4 text-brand-fg" aria-hidden />
          <Badge tone={PRIORITY_TONE[announcement.priority]}>
            {announcement.priority}
          </Badge>
          {announcement.requires_ack ? (
            <Badge tone={acknowledged ? "success" : "warning"}>
              {acknowledged ? "Acknowledged" : "Acknowledgment required"}
            </Badge>
          ) : null}
          {muted ? <Badge tone="neutral">Expired</Badge> : null}
          <span className="meta ml-auto">
            {relativeTime(announcement.publish_at)}
          </span>
        </div>

        <h2 className="text-[16px] font-semibold">{announcement.title}</h2>
        {announcement.message?.body ? (
          <p className="mt-1.5 text-[13.5px] whitespace-pre-wrap">
            {announcement.message.body}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {announcement.author ? (
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Avatar
                name={announcement.author.full_name}
                src={announcement.author.avatar_url}
                size="xs"
              />
              {announcement.author.full_name}
            </span>
          ) : null}
          {announcement.ack_deadline ? (
            <span className="meta">
              Acknowledge by {formatDate(announcement.ack_deadline)}
            </span>
          ) : null}
          {announcement.message?.channel_id ? (
            <Link
              href={`/channels/${announcement.message.channel_id}`}
              className="text-[12.5px] font-medium text-brand-fg hover:underline"
            >
              Open in channel →
            </Link>
          ) : null}
          <span className="ml-auto">
            {needsAck ? (
              <AcknowledgeButton announcementId={announcement.id} />
            ) : acknowledged ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success-fg">
                <CheckCircle2 className="size-4" aria-hidden />
                You acknowledged this
              </span>
            ) : null}
          </span>
        </div>

        {/* Aggregate progress, scoped to admins (P0-ANN-04) */}
        {session.isAdmin && announcement.requires_ack ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="meta mb-1">
              {ackCount} of {totalMembers ?? 0} members acknowledged
            </p>
            <ProgressBar
              percent={
                totalMembers && totalMembers > 0
                  ? (ackCount / totalMembers) * 100
                  : 0
              }
              tone={
                totalMembers && ackCount >= totalMembers ? "good" : "attention"
              }
            />
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Official communication"
        title="Announcements"
        description="Organization-wide notices. Items requiring acknowledgment stay visible until you confirm them."
        actions={session.isAdmin ? <AnnouncementComposeDialog /> : undefined}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="No announcements yet"
          description="Official notices from leadership appear here, and stay pinned until acknowledged when required."
        />
      ) : (
        <div className="max-w-3xl space-y-8">
          <section aria-labelledby="active-announcements">
            <h2
              id="active-announcements"
              className="section-heading mb-3 flex items-center gap-1.5"
            >
              <Pin className="size-4 text-muted" aria-hidden />
              Current
            </h2>
            {active.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No active announcements right now.
              </p>
            ) : (
              <div className="space-y-3">
                {active.map((announcement) => (
                  <AnnouncementCard
                    key={announcement.id}
                    announcement={announcement}
                  />
                ))}
              </div>
            )}
          </section>

          {history.length > 0 ? (
            <section aria-labelledby="announcement-history">
              <h2 id="announcement-history" className="section-heading mb-3">
                History
              </h2>
              <div className="space-y-3">
                {history.map((announcement) => (
                  <AnnouncementCard
                    key={announcement.id}
                    announcement={announcement}
                    muted
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
