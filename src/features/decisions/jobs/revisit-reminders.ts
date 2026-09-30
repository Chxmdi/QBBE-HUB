import { recipientLocales, reminderDate } from "@/features/jobs/services/i18n";
import { createNotifications, type NotificationDraft } from "@/features/jobs/services/notify";
import type { JobContext, JobResult } from "@/features/jobs/services/runner";
import { DECISIONS_V2_FLAG, overrideTurnsOn } from "../flag";
import { decisionsV2T } from "../i18n";
import { isDueForRevisit, revisitRecipients } from "../revisit";

interface DecisionRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  title: string;
  decided_by: string | null;
  revisit_on: string;
  revisit_reminded_at: string | null;
  reopened_at: string | null;
}

function dateInZone(timezone: string, at: Date): string {
  try {
    // "en-CA" is a machine format here (YYYY-MM-DD), compared as a string.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Tells the decider and the participants when a decision reaches its revisit
 * date (Workspace OS V1-10). Once per date: the row is stamped after the
 * notifications are written, and moving the date clears the stamp in the
 * database (app.decision_v2_guard), so a new date is reminded again. A day the
 * job did not run is caught up the next day, because anything on or before
 * today that was not stamped is still due.
 *
 * Only active members who can still read the decision are told. Silent while
 * the `wos_decisions_v2` switch is off.
 */
export async function decisionRevisitReminders({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!overrideTurnsOn(DECISIONS_V2_FLAG)) {
    const { data: flag } = await db.from("feature_flag").select("enabled").eq("key", DECISIONS_V2_FLAG).maybeSingle();
    if (flag?.enabled !== true) return { processed: 0, failed: 0, metadata: { skipped: "switched off" } };
  }

  // Tomorrow in UTC is at or after "today" in every organization's zone; the
  // per-organization check below narrows it.
  const horizon = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("decision")
    .select("id, organization_id, project_id, title, decided_by, revisit_on, revisit_reminded_at, reopened_at")
    .not("revisit_on", "is", null)
    .is("revisit_reminded_at", null)
    .lte("revisit_on", horizon)
    .order("revisit_on", { ascending: true })
    .limit(definition.batch_size);
  if (error) throw new Error(`could not load decisions: ${error.message}`);
  const rows = (data ?? []) as DecisionRow[];
  if (rows.length === 0) return { processed: 0, failed: 0, metadata: { scanned: 0 } };

  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const { data: organizations } = await db.from("organization").select("id, timezone").in("id", orgIds);
  const zones = new Map(
    ((organizations ?? []) as { id: string; timezone: string | null }[]).map((o) => [o.id, o.timezone || "America/Toronto"]),
  );
  const due = rows.filter((r) => isDueForRevisit(r, dateInZone(zones.get(r.organization_id) ?? "America/Toronto", now)));
  if (due.length === 0) return { processed: 0, failed: 0, metadata: { scanned: rows.length } };

  const { data: participantRows, error: participantError } = await db
    .from("decision_participant")
    .select("decision_id, user_id")
    .in("decision_id", due.map((d) => d.id));
  if (participantError) throw new Error(`could not load participants: ${participantError.message}`);
  const participants = new Map<string, string[]>();
  for (const p of (participantRows ?? []) as { decision_id: string; user_id: string }[]) {
    participants.set(p.decision_id, [...(participants.get(p.decision_id) ?? []), p.user_id]);
  }

  // Only people still active in the organization are told.
  const everyone = [...new Set(due.flatMap((d) => revisitRecipients(d.decided_by, participants.get(d.id) ?? [])))];
  const { data: members } = await db
    .from("organization_membership")
    .select("organization_id, user_id")
    .in("user_id", everyone.length > 0 ? everyone : ["00000000-0000-0000-0000-000000000000"])
    .eq("status", "active");
  const active = new Set(((members ?? []) as { organization_id: string; user_id: string }[]).map((m) => `${m.organization_id}:${m.user_id}`));
  const locales = await recipientLocales(db, everyone);

  const drafts: NotificationDraft[] = [];
  for (const decision of due) {
    for (const userId of revisitRecipients(decision.decided_by, participants.get(decision.id) ?? [])) {
      if (!active.has(`${decision.organization_id}:${userId}`)) continue;
      // Access can change after someone is added: a reminder names the
      // decision, so it only goes to someone who can still open it.
      const { data: readable } = await db.rpc("decision_readable_by", { p_decision: decision.id, p_user: userId });
      if (readable !== true) continue;
      const locale = locales.get(userId) ?? "en";
      const t = decisionsV2T(locale);
      drafts.push({
        user_id: userId,
        organization_id: decision.organization_id,
        category: "due_date",
        title: t("notify.title", { title: decision.title }),
        body: t("notify.body", { date: reminderDate(decision.revisit_on, locale) }),
        source_type: "decision",
        source_id: decision.id,
        link: `/decisions/${decision.id}`,
        urgency: "normal",
        dedupe_key: `decision-revisit:${decision.id}:${decision.revisit_on}:${userId}`,
        reason: "decision revisit",
        context: decision.title,
        due_on: decision.revisit_on,
        project_id: decision.project_id,
      });
    }
  }
  const created = await createNotifications(db, drafts);

  let failed = 0;
  const stamp = now.toISOString();
  for (const decision of due) {
    const { error: markError } = await db
      .from("decision")
      .update({ revisit_reminded_at: stamp })
      .eq("id", decision.id)
      .eq("revisit_on", decision.revisit_on);
    if (markError) failed += 1;
  }
  return { processed: due.length, failed, metadata: { scanned: rows.length, notifications: created } };
}
