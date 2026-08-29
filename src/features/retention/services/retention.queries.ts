import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RetentionAction, RetentionSubject } from "@/features/retention/schemas";
import { SUBJECT_HANDLERS, cutoffFor } from "./retention-subjects";

/**
 * What the organization keeps, and what a policy would remove tonight.
 *
 * The preview count is the reason a policy is created switched off. Somebody
 * about to enable a rule that deletes six years of audit trail should see the
 * number first, and see it computed the same way the job will compute it —
 * the same handler, the same cutoff arithmetic.
 */

export interface PolicyRow {
  id: string;
  subject_key: string;
  retain_days: number;
  action: RetentionAction;
  enabled: boolean;
  last_run_at: string | null;
  last_affected: number | null;
  note: string | null;
}

export interface RunRow {
  id: string;
  subject_key: string;
  action: RetentionAction;
  cutoff: string;
  affected: number;
  error: string | null;
  ran_at: string;
}

export interface SubjectView {
  subject: RetentionSubject;
  policy: PolicyRow | null;
  /** How many rows the current settings would affect, or null if unknown. */
  wouldAffect: number | null;
}

export interface RetentionOverview {
  subjects: SubjectView[];
  runs: RunRow[];
}

export async function getRetentionOverview(
  organizationId: string,
  now: Date,
): Promise<RetentionOverview> {
  const supabase = await createSupabaseServerClient();

  const [{ data: subjects }, { data: policies }, { data: runs }] =
    await Promise.all([
      supabase.from("retention_subject").select("*").order("label"),
      supabase.from("retention_policy").select("*"),
      supabase
        .from("retention_run")
        .select("id, subject_key, action, cutoff, affected, error, ran_at")
        .order("ran_at", { ascending: false })
        .limit(30),
    ]);

  const subjectRows = (subjects ?? []) as unknown as RetentionSubject[];
  const policyRows = (policies ?? []) as unknown as PolicyRow[];

  const views = await Promise.all(
    subjectRows.map(async (subject) => {
      const policy = policyRows.find((p) => p.subject_key === subject.key) ?? null;
      const days = policy?.retain_days ?? subject.default_days;
      const handler = SUBJECT_HANDLERS[subject.key];

      let wouldAffect: number | null = null;
      if (handler) {
        try {
          wouldAffect = await handler.count(
            supabase,
            organizationId,
            cutoffFor(days, now),
          );
        } catch {
          // A count that fails is not worth breaking the page for; the row
          // simply says nothing rather than showing a wrong number.
          wouldAffect = null;
        }
      }

      return { subject, policy, wouldAffect };
    }),
  );

  return { subjects: views, runs: (runs ?? []) as unknown as RunRow[] };
}
