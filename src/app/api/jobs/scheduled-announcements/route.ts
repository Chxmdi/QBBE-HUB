import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordJobRun } from "@/lib/job-observability";

export const dynamic = "force-dynamic";

/**
 * Fan-out notifications for announcements whose publish_at has arrived
 * (P1-ANN-07). Idempotent via notification.dedupe_key.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch {
    return NextResponse.json({ error: "Service role is not configured." }, { status: 503 });
  }

  const now = new Date().toISOString();
  const { data: due } = await supabase
    .from("announcement")
    .select("id, organization_id, title, priority, created_by, publish_at")
    .lte("publish_at", now)
    .gte("publish_at", new Date(Date.now() - 2 * 86400_000).toISOString())
    .limit(50);

  let fanned = 0;
  for (const announcement of due ?? []) {
    const startedAt = new Date().toISOString();
    const { data: members } = await supabase
      .from("organization_membership")
      .select("user_id")
      .eq("organization_id", announcement.organization_id)
      .eq("status", "active");
    const recipients = (members ?? [])
      .map((m) => m.user_id as string)
      .filter((id) => id !== announcement.created_by);
    if (recipients.length === 0) {
      await recordJobRun(supabase, {
        organizationId: announcement.organization_id,
        jobName: "scheduled_announcements",
        status: "succeeded",
        details: { announcementId: announcement.id, recipients: 0 },
        startedAt,
      });
      continue;
    }
    const { data: inserted, error } = await supabase.from("notification").upsert(
      recipients.map((userId) => ({
        user_id: userId,
        organization_id: announcement.organization_id,
        category: "announcement",
        title: `Announcement: ${announcement.title}`,
        source_type: "announcement",
        source_id: announcement.id,
        link: "/announcements",
        urgency: announcement.priority === "critical" ? "critical" : "normal",
        dedupe_key: `announcement:${announcement.id}:${userId}`,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    ).select("id");
    if (!error) {
      const insertedCount = inserted?.length ?? 0;
      fanned += insertedCount;
      await recordJobRun(supabase, {
        organizationId: announcement.organization_id,
        jobName: "scheduled_announcements",
        status: "succeeded",
        details: { announcementId: announcement.id, recipients: recipients.length, inserted: insertedCount },
        startedAt,
      });
    } else {
      await recordJobRun(supabase, {
        organizationId: announcement.organization_id,
        jobName: "scheduled_announcements",
        status: "failed",
        details: { announcementId: announcement.id, recipients: recipients.length },
        error: error.message,
        startedAt,
      });
    }
  }

  return NextResponse.json({ ok: true, fanned });
}
