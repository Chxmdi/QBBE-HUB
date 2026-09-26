import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDigest,
  digestDedupeKey,
  digestSection,
  localDateString,
} from "@/features/notifications/services/digest";
import {
  PREFERENCE_COLUMNS,
  deliveryMode,
  isDigestDue,
  weekdayIn,
  withPreferenceDefaults,
  type DeliveryPreferences,
} from "@/features/notifications/services/delivery-rules";
import { renderDigestEmail } from "@/features/notifications/services/email-templates";
import { enqueue } from "../queue";
import type { JobContext, JobResult } from "../runner";

/**
 * Builds each person's digest at their own local digest hour.
 *
 * The job runs hourly rather than at one fixed time, and each candidate is
 * filtered by `isDigestHour`, which reads their timezone. That is what keeps
 * a 7am digest at 7am across a daylight-saving change, and what lets people in
 * different zones each get theirs in the morning.
 *
 * The digest is written to the ledger here and handed to the queue for
 * delivery, so a provider outage retries the send without rebuilding content.
 */

interface PreferenceRow extends Partial<DeliveryPreferences> {
  user_id: string;
}

const UNIQUE_VIOLATION = "23505";
const LOOKBACK_DAYS = 7;

export async function dailyDigest({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const { data: prefRows, error } = await db
    .from("notification_preference")
    .select(
      `user_id, ${PREFERENCE_COLUMNS}`,
    )
    .eq("email_digest", true)
    .limit(definition.batch_size);

  if (error) throw new Error(`could not load digest subscribers: ${error.message}`);

  const due = ((prefRows ?? []) as PreferenceRow[]).filter((row) =>
    isDigestDue(withPreferenceDefaults(row), now),
  );

  let processed = 0;
  let skippedEmpty = 0;

  for (const row of due) {
    const prefs = withPreferenceDefaults(row);
    const built = await buildDigestFor(db, row.user_id, prefs, now);

    if (!built) {
      // Nothing waiting. Sending an empty digest teaches people to ignore us.
      skippedEmpty += 1;
      continue;
    }

    const enqueued = await enqueue(db, "notifications", {
      kind: "digest",
      delivery_id: built.deliveryId,
    });
    if (enqueued) processed += 1;
  }

  return {
    processed,
    failed: 0,
    metadata: { candidates: due.length, skippedEmpty },
  };
}

async function buildDigestFor(
  db: SupabaseClient,
  userId: string,
  prefs: DeliveryPreferences,
  now: Date,
): Promise<{ deliveryId: string } | null> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const today = localDateString(prefs.timezone, now);
  const weeklyToday = weekdayIn(prefs.timezone, now) === prefs.digest_weekday;

  const { data: unread } = await db
    .from("notification")
    .select("organization_id, title, body, category, link, created_at, due_on, dedupe_key")
    .eq("user_id", userId)
    .is("read_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (unread ?? []) as unknown as {
    organization_id: string;
    title: string;
    body: string | null;
    category: string;
    link: string | null;
    created_at: string;
    due_on: string | null;
    dedupe_key: string | null;
  }[];

  const sentKeys = new Set<string>();
  const dedupeKeys = rows
    .map((row) => (row.dedupe_key ? `email:${row.dedupe_key}` : null))
    .filter((key): key is string => Boolean(key));
  if (dedupeKeys.length > 0) {
    const { data: sent } = await db
      .from("email_delivery")
      .select("dedupe_key, status")
      .in("dedupe_key", dedupeKeys)
      .eq("status", "sent");
    for (const row of sent ?? []) {
      if (row.dedupe_key) sentKeys.add(row.dedupe_key as string);
    }
  }

  const digestRows = rows.filter((row) => {
    if (row.dedupe_key && sentKeys.has(`email:${row.dedupe_key}`)) return false;
    const mode = deliveryMode(row.category, prefs);
    if (mode === "weekly") return weeklyToday;
    if (mode === "daily") return true;
    if (mode === "immediate" || mode === "off") return false;
    return prefs.email_digest;
  });

  const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const { data: meetings } = await db
    .from("meeting_attendee")
    .select("meeting:meeting_id(id, title, starts_at, organization_id)")
    .eq("user_id", userId)
    .limit(20);

  const meetingItems = ((meetings ?? []) as unknown as {
    meeting: { id: string; title: string; starts_at: string; organization_id: string } | null;
  }[])
    .map((row) => row.meeting)
    .filter((meeting): meeting is NonNullable<typeof meeting> => {
      if (!meeting?.starts_at) return false;
      return meeting.starts_at >= now.toISOString() && meeting.starts_at <= horizon;
    });

  const items = [
    ...digestRows.map((row) => ({
      title: row.title,
      body: row.body,
      category: row.category,
      link: row.link,
      createdAt: row.created_at,
      section: digestSection(
        { category: row.category, title: row.title, dueOn: row.due_on },
        today,
      ),
    })),
    ...meetingItems.map((meeting) => ({
      title: meeting.title,
      body: null,
      category: "meeting",
      link: `/meetings/${meeting.id}`,
      createdAt: meeting.starts_at,
      section: "meetings",
    })),
  ];

  const content = buildDigest(items);
  const organizationId =
    digestRows[0]?.organization_id ?? meetingItems[0]?.organization_id;
  if (!content || !organizationId) return null;

  const [{ data: profile }, { data: organization }] = await Promise.all([
    db.from("user_profile").select("full_name, email").eq("id", userId).maybeSingle(),
    db.from("organization").select("name").eq("id", organizationId).maybeSingle(),
  ]);

  const recipient = (profile?.email as string | undefined) ?? null;
  if (!recipient || !recipient.includes("@")) return null;

  const email = renderDigestEmail({
    recipientName: (profile?.full_name as string | undefined) || "there",
    organizationName: (organization?.name as string | undefined) ?? "QBBE",
    groups: content.groups,
    totalCount: content.totalCount,
    shownCount: content.shownCount,
  });

  const dedupeKey = digestDedupeKey(userId, localDateString(prefs.timezone, now));

  const { data, error } = await db
    .from("email_delivery")
    .insert({
      organization_id: organizationId,
      recipient_user_id: userId,
      recipient,
      subject: email.subject,
      body_text: email.text,
      body_html: email.html,
      category: "digest",
      kind: "digest",
      status: "queued",
      dedupe_key: dedupeKey,
    })
    .select("id")
    .single();

  if (error) {
    // Already built today — one digest per person per local day.
    if (error.code === UNIQUE_VIOLATION) return null;
    throw new Error(`could not record digest: ${error.message}`);
  }

  return { deliveryId: (data as { id: string }).id };
}
