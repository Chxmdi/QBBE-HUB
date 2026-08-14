import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Fan-out notifications for announcements whose publish_at has arrived
 * (P1-ANN-07). Idempotent via notification.dedupe_key.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_JOB_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
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
    const { data: members } = await supabase
      .from("organization_membership")
      .select("user_id")
      .eq("organization_id", announcement.organization_id)
      .eq("status", "active");
    const recipients = (members ?? [])
      .map((m) => m.user_id as string)
      .filter((id) => id !== announcement.created_by);
    if (recipients.length === 0) continue;
    const { error } = await supabase.from("notification").insert(
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
    );
    if (!error) fanned += recipients.length;
  }

  return NextResponse.json({ ok: true, fanned });
}
