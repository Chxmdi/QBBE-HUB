import { createNotifications, type NotificationDraft } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Reminds people who have not acknowledged a required announcement (ANN-005).
 *
 * One reminder per person per announcement per day: the dedupe key carries the
 * date, so a job that runs twice — a manual trigger after the scheduled one,
 * say — cannot double-nudge anyone. Announcements past their acknowledgement
 * deadline stop nudging; at that point it is a management conversation, not a
 * notification problem.
 */

interface AnnouncementRow {
  id: string;
  organization_id: string;
  title: string;
  ack_deadline: string | null;
  publish_at: string;
}

export async function announcementNudge({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const nowIso = now.toISOString();

  const { data: announcementRows, error } = await db
    .from("announcement")
    .select("id, organization_id, title, ack_deadline, publish_at")
    .eq("requires_ack", true)
    .lte("publish_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("publish_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`could not load announcements: ${error.message}`);

  const announcements = ((announcementRows ?? []) as unknown as AnnouncementRow[]).filter(
    (row) => !row.ack_deadline || new Date(row.ack_deadline) > now,
  );
  if (announcements.length === 0) {
    return { processed: 0, failed: 0, metadata: { announcements: 0 } };
  }

  const { data: memberRows } = await db
    .from("organization_membership")
    .select("user_id, organization_id")
    .eq("status", "active");

  const members = (memberRows ?? []) as { user_id: string; organization_id: string }[];
  const today = nowIso.slice(0, 10);

  let nudged = 0;

  for (const announcement of announcements) {
    const { data: ackRows } = await db
      .from("announcement_acknowledgment")
      .select("user_id")
      .eq("announcement_id", announcement.id);

    const acknowledged = new Set(
      ((ackRows ?? []) as { user_id: string }[]).map((row) => row.user_id),
    );

    const outstanding = members
      .filter(
        (member) =>
          member.organization_id === announcement.organization_id &&
          !acknowledged.has(member.user_id),
      )
      .slice(0, definition.batch_size);

    if (outstanding.length === 0) continue;

    const drafts: NotificationDraft[] = outstanding.map((member) => ({
      user_id: member.user_id,
      organization_id: announcement.organization_id,
      category: "announcement",
      title: `Still needs your acknowledgement: ${announcement.title}`,
      body: announcement.ack_deadline
        ? `Acknowledge by ${new Date(announcement.ack_deadline).toDateString()}.`
        : "Open the announcement and acknowledge it.",
      source_type: "announcement",
      source_id: announcement.id,
      link: "/announcements",
      // High urgency puts this past the opt-out switches: a required
      // acknowledgement is not routine mail (NTF-003).
      urgency: "high",
      dedupe_key: `ack-nudge:${announcement.id}:${member.user_id}:${today}`,
    }));

    nudged += await createNotifications(db, drafts);
  }

  return {
    processed: nudged,
    failed: 0,
    metadata: { announcements: announcements.length },
  };
}
