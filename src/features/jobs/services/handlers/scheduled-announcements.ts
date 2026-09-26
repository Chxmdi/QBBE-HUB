import { recordJobRun } from "@/lib/job-observability";
import { createNotifications, notificationDedupeKey } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Fans out notifications for announcements whose publish time has arrived
 * (P1-ANN-07).
 *
 * The window looks back two days rather than only at the current minute, so an
 * outage in the runtime delays an announcement instead of losing it. Repeats
 * are harmless: the dedupe key is the announcement and the recipient, so a
 * second pass inserts nothing.
 */

interface AnnouncementRow {
  id: string;
  organization_id: string;
  title: string;
  priority: string;
  created_by: string;
  publish_at: string;
}

const LOOKBACK_MS = 2 * 86_400_000;

export async function scheduledAnnouncements({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const { data: dueRows, error } = await db
    .from("announcement")
    .select("id, organization_id, title, priority, created_by, publish_at")
    .lte("publish_at", now.toISOString())
    .gte("publish_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .order("publish_at", { ascending: true })
    .limit(definition.batch_size);

  if (error) throw new Error(`could not load announcements: ${error.message}`);

  let fanned = 0;
  let failed = 0;

  for (const announcement of (dueRows ?? []) as unknown as AnnouncementRow[]) {
    const startedAt = new Date().toISOString();

    const { data: members } = await db
      .from("organization_membership")
      .select("user_id")
      .eq("organization_id", announcement.organization_id)
      .eq("status", "active");

    // The author already knows.
    const recipients = ((members ?? []) as { user_id: string }[])
      .map((member) => member.user_id)
      .filter((id) => id !== announcement.created_by);

    if (recipients.length === 0) continue;

    let count = 0;
    try {
      count = await createNotifications(
        db,
        recipients.map((userId) => ({
          user_id: userId,
          organization_id: announcement.organization_id,
          category: "announcement",
          title: `Announcement: ${announcement.title}`,
          source_type: "announcement",
          source_id: announcement.id,
          link: `/announcements#${announcement.id}`,
          urgency: (announcement.priority === "critical" ? "critical" : "normal") as
            | "critical"
            | "normal",
          reason: "announcement",
          context: announcement.title,
          dedupe_key: notificationDedupeKey("announcement", announcement.id, userId),
        })),
      );
    } catch (error) {
      failed += 1;
      await recordJobRun(db, {
        organizationId: announcement.organization_id,
        jobName: "scheduled-announcements",
        status: "failed",
        details: { announcementId: announcement.id, recipients: recipients.length },
        error: error instanceof Error ? error.message : "Could not notify.",
        startedAt,
      });
      continue;
    }

    fanned += count;
    await recordJobRun(db, {
      organizationId: announcement.organization_id,
      jobName: "scheduled-announcements",
      status: "succeeded",
      details: {
        announcementId: announcement.id,
        recipients: recipients.length,
        inserted: count,
      },
      startedAt,
    });
  }

  return {
    processed: fanned,
    failed,
    metadata: { announcements: (dueRows ?? []).length },
  };
}
