import { recordJobRun } from "@/lib/job-observability";
import { fireWorkflows } from "@/features/admin/services/workflow.runtime";
import { recipientTranslators } from "@/features/channels/recipient-locale";
import { fanOutAnnouncement, notificationDedupeKey } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Posts and fans out announcements whose publish time has arrived
 * (P1-ANN-07).
 *
 * A scheduled announcement waits with no channel message, so its text is not
 * readable before it is due. The first step posts the waiting message of
 * every due announcement, whatever its age, so an outage only delays it.
 *
 * The second step notifies the readers of each due announcement not yet
 * fanned out, oldest first. public.fan_out_announcement marks it and creates
 * its notifications in one transaction: a run that fails leaves it for the
 * next, and one that succeeded is never sent again. (Sending again would
 * re-open what people had read, unread and emailed once more.) The window
 * looks back two days, so an outage delays an announcement instead of
 * losing it.
 */

interface AnnouncementRow {
  id: string;
  organization_id: string;
  title: string;
  priority: string;
  created_by: string;
  publish_at: string;
}

interface WaitingRow {
  id: string;
  organization_id: string;
  title: string;
  created_by: string;
}

const LOOKBACK_MS = 2 * 86_400_000;

export async function scheduledAnnouncements({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const { data: waiting, error: waitingError } = await db
    .from("announcement")
    .select("id, organization_id, title, created_by")
    .is("message_id", null)
    .lte("publish_at", now.toISOString())
    .order("publish_at", { ascending: true })
    .limit(definition.batch_size);

  if (waitingError) throw new Error(`could not load waiting announcements: ${waitingError.message}`);

  let released = 0;
  let failed = 0;
  for (const row of (waiting ?? []) as WaitingRow[]) {
    const { data: messageId, error: releaseError } = await db.rpc(
      "release_scheduled_announcement",
      { p_announcement: row.id },
    );
    if (releaseError) {
      failed += 1;
      continue;
    }
    // Null means another run posted it first; only the run that posted it
    // fires the workflows, so they run once.
    if (!messageId) continue;
    released += 1;
    // Publishing now fires these at once; a scheduled announcement fires them
    // when it actually goes out.
    await fireWorkflows(db, {
      organizationId: row.organization_id,
      actorId: row.created_by,
      eventType: "announcement_published",
      title: row.title,
      sourceType: "announcement",
      sourceId: row.id,
      link: "/announcements",
    });
  }

  const { data: dueRows, error } = await db
    .from("announcement")
    .select("id, organization_id, title, priority, created_by, publish_at")
    .not("message_id", "is", null)
    .is("fanned_out_at", null)
    .lte("publish_at", now.toISOString())
    .gte("publish_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .order("publish_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(definition.batch_size);

  if (error) throw new Error(`could not load announcements: ${error.message}`);

  let fanned = 0;

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

    let count = 0;
    try {
      // Each person reads the notification in their own saved language.
      const translatorFor = await recipientTranslators(db, recipients);
      // With nobody to tell, this still marks the announcement done.
      const sent = await fanOutAnnouncement(
        db,
        announcement.id,
        recipients.map((userId) => ({
          user_id: userId,
          organization_id: announcement.organization_id,
          category: "announcement",
          title: translatorFor(userId)("jobs.notify.announcementTitle", {
            title: announcement.title,
          }),
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
      // Null: another run fanned it out first.
      count = sent ?? 0;
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
    // Only a pass that reached someone is worth a ledger row (OPS-001).
    if (count === 0) continue;
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
    metadata: { announcements: (dueRows ?? []).length, released },
  };
}
