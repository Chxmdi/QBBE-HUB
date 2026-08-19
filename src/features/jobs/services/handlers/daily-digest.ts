import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDigest,
  digestDedupeKey,
  localDateString,
} from "@/features/notifications/services/digest";
import {
  isDigestHour,
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
      "user_id, email_critical, email_digest, email_assignments, email_mentions, email_announcements, email_due_dates, quiet_hours_start, quiet_hours_end, digest_hour, timezone",
    )
    .eq("email_digest", true)
    .limit(definition.batch_size);

  if (error) throw new Error(`could not load digest subscribers: ${error.message}`);

  const due = ((prefRows ?? []) as PreferenceRow[]).filter((row) =>
    isDigestHour(withPreferenceDefaults(row), now),
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

  const { data: unread } = await db
    .from("notification")
    .select("organization_id, title, body, category, link, created_at")
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
  }[];

  const content = buildDigest(
    rows.map((row) => ({
      title: row.title,
      body: row.body,
      category: row.category,
      link: row.link,
      createdAt: row.created_at,
    })),
  );
  if (!content) return null;

  const [{ data: profile }, { data: organization }] = await Promise.all([
    db.from("user_profile").select("full_name, email").eq("id", userId).maybeSingle(),
    db.from("organization").select("name").eq("id", rows[0].organization_id).maybeSingle(),
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
      organization_id: rows[0].organization_id,
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
