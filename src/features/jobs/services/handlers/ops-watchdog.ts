import type { SupabaseClient } from "@supabase/supabase-js";
import { isLocale } from "@/lib/i18n/config";
import { scheduleIntervalMs } from "../cron";
import { translators } from "../i18n";
import { createNotifications, notificationDedupeKey, type NotificationDraft } from "../notify";
import { isOverdue } from "../run-health";
import type { JobContext, JobResult } from "../runner";

/**
 * Tells owners and admins when the Hub's machinery is failing, before users
 * notice: a job that stopped running or keeps failing, a queue backing up,
 * webhook deliveries being refused, or the database nearing the free plan's
 * size limit (it turns read-only there).
 *
 * One in-app notification (and email, through the normal delivery rules) per
 * condition per person per day: the date is part of the dedupe key, so a
 * condition that lasts all day does not alert every 15 minutes, and one that
 * lasts into tomorrow alerts again.
 *
 * It cannot report a dead server or an expired certificate (it runs on that
 * server): that is the external uptime monitor's job (docs/runbooks/jobs.md).
 */

/** The Supabase Free plan's database limit. OPS_DATABASE_LIMIT_MB overrides it on a paid plan. */
export const DEFAULT_DATABASE_LIMIT_MB = 500;
export const DATABASE_ALERT_RATIO = 0.7;
export const FAILURES_IN_A_ROW = 3;
export const QUEUE_AGE_SECONDS = 15 * 60;
export const REFUSALS_PER_HOUR = 10;
/** Refusal reasons that point at forged deliveries or a rotated secret. */
const ALERTING_REASONS = new Set(["signature_invalid", "unauthorized"]);

export interface OpsSnapshot {
  database_bytes: number;
  jobs: {
    name: string;
    schedule: string;
    enabled: boolean;
    last_started_at: string | null;
    failures_in_a_row: number;
  }[];
  refusals: { bucket: string; count: number }[];
}

export interface QueueAge {
  queue_name: string;
  oldest_message_age_seconds: number | null;
}

export type OpsAlert =
  | { kind: "overdue"; key: string; job: string }
  | { kind: "failing"; key: string; job: string; count: number }
  | { kind: "queue"; key: string; queue: string; minutes: number }
  | { kind: "database"; key: string; percent: number; limitMb: number }
  | { kind: "refusals"; key: string; source: string; count: number };

/** Every condition that needs an operator now. Pure, so it is tested alone. */
export function opsAlerts(
  snapshot: OpsSnapshot,
  queues: QueueAge[],
  now: Date,
  limitMb = DEFAULT_DATABASE_LIMIT_MB,
): OpsAlert[] {
  const alerts: OpsAlert[] = [];
  for (const job of snapshot.jobs) {
    if (!job.enabled || job.name === "ops-watchdog") continue;
    if (job.failures_in_a_row >= FAILURES_IN_A_ROW) {
      alerts.push({ kind: "failing", key: `failing:${job.name}`, job: job.name, count: job.failures_in_a_row });
    } else if (isOverdue(job.enabled, job.last_started_at, scheduleIntervalMs(job.schedule, now), now)) {
      alerts.push({ kind: "overdue", key: `overdue:${job.name}`, job: job.name });
    }
  }
  for (const queue of queues) {
    const age = queue.oldest_message_age_seconds ?? 0;
    if (age > QUEUE_AGE_SECONDS) {
      alerts.push({ kind: "queue", key: `queue:${queue.queue_name}`, queue: queue.queue_name, minutes: Math.round(age / 60) });
    }
  }
  const limitBytes = limitMb * 1024 * 1024;
  if (snapshot.database_bytes >= DATABASE_ALERT_RATIO * limitBytes) {
    alerts.push({
      kind: "database",
      key: "database",
      percent: Math.round((snapshot.database_bytes / limitBytes) * 100),
      limitMb,
    });
  }
  const bySource = new Map<string, number>();
  for (const { bucket, count } of snapshot.refusals) {
    // webhook-refused:<source>:<reason>
    const [, source, reason] = bucket.split(":");
    if (!source || !ALERTING_REASONS.has(reason)) continue;
    bySource.set(source, (bySource.get(source) ?? 0) + count);
  }
  for (const [source, count] of bySource) {
    if (count >= REFUSALS_PER_HOUR) alerts.push({ kind: "refusals", key: `refusals:${source}`, source, count });
  }
  return alerts;
}

interface Recipient {
  user_id: string;
  organization_id: string;
  locale: string | null;
}

async function loadRecipients(db: SupabaseClient): Promise<Recipient[]> {
  const { data, error } = await db
    .from("organization_membership")
    .select("user_id, organization_id, user:user_id(locale)")
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  if (error) throw new Error(`could not load owners and admins: ${error.message}`);
  return ((data ?? []) as unknown as { user_id: string; organization_id: string; user: { locale: string | null } | null }[]).map(
    (row) => ({ user_id: row.user_id, organization_id: row.organization_id, locale: row.user?.locale ?? null }),
  );
}

export async function opsWatchdog({ db, now }: JobContext): Promise<JobResult> {
  const [{ data: snapshot, error: snapshotError }, { data: queues, error: queueError }] = await Promise.all([
    db.rpc("ops_health_snapshot"),
    db.rpc("job_queue_health"),
  ]);
  if (snapshotError) throw new Error(`could not read the operations snapshot: ${snapshotError.message}`);
  if (queueError) throw new Error(`could not read queue health: ${queueError.message}`);

  const limitMb = Number(process.env.OPS_DATABASE_LIMIT_MB) || DEFAULT_DATABASE_LIMIT_MB;
  const alerts = opsAlerts(snapshot as OpsSnapshot, (queues ?? []) as QueueAge[], now, limitMb);
  if (alerts.length === 0) return { processed: 0, failed: 0, metadata: { alerts: 0 } };

  const recipients = await loadRecipients(db);
  const tFor = translators();
  const day = now.toISOString().slice(0, 10);
  const drafts: NotificationDraft[] = [];
  for (const recipient of recipients) {
    const t = tFor(isLocale(recipient.locale) ? recipient.locale : undefined);
    for (const alert of alerts) {
      const title =
        alert.kind === "overdue" ? t("jobs.opsAlert.overdue", { job: alert.job })
        : alert.kind === "failing" ? t("jobs.opsAlert.failing", { job: alert.job, count: alert.count })
        : alert.kind === "queue" ? t("jobs.opsAlert.queue", { queue: alert.queue, minutes: alert.minutes })
        : alert.kind === "database" ? t("jobs.opsAlert.database", { percent: alert.percent, limit: alert.limitMb })
        : t("jobs.opsAlert.refusals", { source: alert.source, count: alert.count });
      drafts.push({
        user_id: recipient.user_id,
        organization_id: recipient.organization_id,
        category: "system",
        urgency: "high",
        title,
        body: t("jobs.opsAlert.body"),
        link: "/admin/jobs",
        source_type: "ops",
        dedupe_key: notificationDedupeKey("ops", alert.key, recipient.user_id, day),
      });
    }
  }
  // Already told today: leave it alone. Writing it again would mark it unread
  // every 15 minutes.
  const { data: existing, error: existingError } = await db
    .from("notification")
    .select("user_id, dedupe_key")
    .in("user_id", [...new Set(drafts.map((d) => d.user_id))])
    .in("dedupe_key", drafts.map((d) => d.dedupe_key));
  if (existingError) throw new Error(`could not read earlier alerts: ${existingError.message}`);
  const told = new Set(((existing ?? []) as { user_id: string; dedupe_key: string }[]).map((r) => `${r.user_id} ${r.dedupe_key}`));
  const created = await createNotifications(db, drafts.filter((d) => !told.has(`${d.user_id} ${d.dedupe_key}`)));
  return { processed: created, failed: 0, metadata: { alerts: alerts.map((a) => a.key) } };
}
