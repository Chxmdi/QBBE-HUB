import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIME_ZONE, calendarDateInZone } from "@/lib/time";
import { isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { renderTeamDigestEmail } from "@/features/notifications/services/email-templates";
import { personWorkHref } from "@/features/people/person-work";
import {
  signalReason,
  signalsFromDigestRow,
  thresholdsFrom,
  type AttentionThresholds,
  type SignalKind,
} from "@/features/people/team-overview";
import { recipientLocales, translators } from "../i18n";
import { createNotifications, type NotificationDraft } from "../notify";
import { enqueue } from "../queue";
import type { JobContext, JobResult } from "../runner";
import { isoWeekKey } from "./stale-project-sweep";

/**
 * Team signals (#136, phase 3).
 *
 * `team-signal-reminders` (daily) brings `team_signal` up to date through
 * `sync_team_signals()` and sends the person one gentle notification for each
 * batch of new signals. A signal that keeps standing is not reminded again;
 * one that clears and comes back is new. Notifications go through the usual
 * write path, so the person's own notification settings decide whether and
 * when it is also emailed.
 *
 * `team-signal-digest` (Mondays) emails every active owner and admin the
 * people who have an open signal right now. Nobody with no signal is named,
 * and an organization with none gets no email at all.
 *
 * Both only act for organizations that switched them on in Admin, Team
 * signals. Neither reads sign-ins, sessions, presence or messages.
 */

const UNIQUE_VIOLATION = "23505";

interface SettingsRow {
  organization_id: string;
  overdue_count: number;
  overdue_age_days: number;
  blocked_no_update_days: number;
  in_progress_no_update_days: number;
  flag_project_reports: boolean;
  flag_overdue_decisions: boolean;
}

interface NewSignal {
  signal_id: string;
  user_id: string;
  kind: SignalKind;
  item_count: number;
  oldest_overdue_days: number | null;
}

interface DigestRow {
  user_id: string;
  full_name: string;
  kinds: string[];
  overdue: number;
  oldest_overdue_days: number | null;
  blocked_stale: number;
  in_progress_stale: number;
  stale_projects: number;
  overdue_decisions: number;
}

async function enabledOrganizations(
  db: SupabaseClient,
  column: "reminders_enabled" | "digest_enabled",
  limit: number,
): Promise<SettingsRow[]> {
  const { data, error } = await db
    .from("team_signal_settings")
    .select(
      "organization_id, overdue_count, overdue_age_days, blocked_no_update_days, in_progress_no_update_days, flag_project_reports, flag_overdue_decisions",
    )
    .eq(column, true)
    .limit(limit);
  if (error) throw new Error(`could not load team signal settings: ${error.message}`);
  return (data ?? []) as SettingsRow[];
}

/** The organization's calendar date, so "overdue" turns over at its midnight. */
async function organizationToday(db: SupabaseClient, organizationId: string, now: Date) {
  const { data } = await db
    .from("organization")
    .select("name, timezone")
    .eq("id", organizationId)
    .maybeSingle();
  const zone = (data?.timezone as string | undefined) ?? DEFAULT_TIME_ZONE;
  return {
    name: (data?.name as string | undefined) ?? "QBBE",
    today: calendarDateInZone(now, zone) ?? now.toISOString().slice(0, 10),
  };
}

/** The reminder a person reads, in their language. */
export function reminderDraft(
  organizationId: string,
  userId: string,
  signals: NewSignal[],
  thresholds: AttentionThresholds,
  t: ReturnType<typeof createTranslator>,
): NotificationDraft {
  const reasons = signals
    .map((signal) =>
      signalReason(
        { kind: signal.kind, count: signal.item_count, oldestDays: signal.oldest_overdue_days },
        thresholds,
        t,
      ),
    )
    .join("; ");
  const ids = signals.map((signal) => signal.signal_id).sort();
  return {
    user_id: userId,
    organization_id: organizationId,
    category: "system",
    title: t("jobs.notify.teamSignalTitle"),
    body: t("jobs.notify.teamSignalBody", { reasons }),
    source_type: "team_signal",
    source_id: ids[0],
    link: personWorkHref(userId),
    // Gentle: someone who reads email in a digest gets it there, not at once.
    urgency: "low",
    // One key per set of signals: a rerun on the same day cannot send it twice,
    // and team_signal.reminded_at keeps a standing signal from coming back.
    dedupe_key: `team-signal:${ids.join(",")}`,
    reason: "work signal",
  };
}

export async function teamSignalReminders({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const organizations = await enabledOrganizations(db, "reminders_enabled", definition.batch_size);
  let processed = 0;
  let signals = 0;
  const translatorFor = translators();

  for (const settings of organizations) {
    const { today } = await organizationToday(db, settings.organization_id, now);
    const { data, error } = await db.rpc("sync_team_signals", {
      p_organization_id: settings.organization_id,
      p_today: today,
    });
    if (error) throw new Error(`could not update team signals: ${error.message}`);

    const fresh = (data ?? []) as NewSignal[];
    if (fresh.length === 0) continue;
    signals += fresh.length;

    const byPerson = new Map<string, NewSignal[]>();
    for (const signal of fresh) {
      byPerson.set(signal.user_id, [...(byPerson.get(signal.user_id) ?? []), signal]);
    }
    const locales = await recipientLocales(db, [...byPerson.keys()]);
    const thresholds = thresholdsFrom(settings);
    const drafts = [...byPerson.entries()].map(([userId, list]) =>
      reminderDraft(
        settings.organization_id,
        userId,
        list,
        thresholds,
        translatorFor(locales.get(userId) ?? "en"),
      ),
    );

    processed += await createNotifications(db, drafts);

    const { error: markError } = await db
      .from("team_signal")
      .update({ reminded_at: now.toISOString() })
      .in(
        "id",
        fresh.map((signal) => signal.signal_id),
      );
    if (markError) throw new Error(`could not record reminders: ${markError.message}`);
  }

  return {
    processed,
    failed: 0,
    metadata: { organizations: organizations.length, signals },
  };
}

export async function teamSignalDigest({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const organizations = await enabledOrganizations(db, "digest_enabled", definition.batch_size);
  const week = isoWeekKey(now);
  let processed = 0;
  let skipped = 0;

  for (const settings of organizations) {
    const { name: organizationName, today } = await organizationToday(
      db,
      settings.organization_id,
      now,
    );
    const { data, error } = await db.rpc("team_signal_digest", {
      p_organization_id: settings.organization_id,
      p_today: today,
    });
    if (error) throw new Error(`could not list team signals: ${error.message}`);
    const people = (data ?? []) as DigestRow[];
    // Nobody with a signal means no email: an empty digest teaches people to ignore it.
    if (people.length === 0) {
      skipped += 1;
      continue;
    }

    const { data: admins, error: adminError } = await db
      .from("organization_membership")
      .select("user_id, user:user_id(full_name, email, locale)")
      .eq("organization_id", settings.organization_id)
      .eq("status", "active")
      .in("role", ["owner", "admin"]);
    if (adminError) throw new Error(`could not load admins: ${adminError.message}`);

    const thresholds = thresholdsFrom(settings);
    for (const admin of (admins ?? []) as unknown as {
      user_id: string;
      user: { full_name: string | null; email: string | null; locale: string | null } | null;
    }[]) {
      const email = admin.user?.email ?? null;
      if (!email || !email.includes("@")) continue;
      const locale = isLocale(admin.user?.locale) ? admin.user!.locale! : "en";
      const t = createTranslator(locale as "en" | "fr-CA");
      const body = renderTeamDigestEmail({
        locale,
        recipientName: admin.user?.full_name || t("jobs.email.fallbackName"),
        organizationName,
        people: people.map((person) => ({
          name: person.full_name,
          link: personWorkHref(person.user_id),
          reasons: signalsFromDigestRow(person).map((signal) =>
            signalReason(signal, thresholds, t),
          ),
        })),
      });

      const { data: delivery, error: insertError } = await db
        .from("email_delivery")
        .insert({
          organization_id: settings.organization_id,
          recipient_user_id: admin.user_id,
          recipient: email,
          subject: body.subject,
          body_text: body.text,
          body_html: body.html,
          category: "team_digest",
          kind: "system",
          status: "queued",
          // One digest per admin per organization per ISO week.
          dedupe_key: `team-digest:${settings.organization_id}:${admin.user_id}:${week}`,
        })
        .select("id")
        .single();
      if (insertError) {
        if (insertError.code === UNIQUE_VIOLATION) continue;
        throw new Error(`could not record team digest: ${insertError.message}`);
      }

      await enqueue(db, "notifications", {
        kind: "system",
        delivery_id: (delivery as { id: string }).id,
      });
      processed += 1;
    }
  }

  return {
    processed,
    failed: 0,
    metadata: { organizations: organizations.length, withoutSignals: skipped },
  };
}
