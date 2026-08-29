import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How each governed record type is counted and cleared.
 *
 * The set of keys here must match `retention_subject` exactly. That table is
 * the whitelist — a policy cannot name anything absent from it — and this map
 * is the other half: a key with no implementation is a policy that silently
 * does nothing every night, which is worse than one that fails, because an
 * administrator would believe their retention rule was working.
 *
 * A test pins the two lists to each other for that reason.
 */

export interface SubjectHandler {
  /** How many rows are older than the cutoff. */
  count(
    db: SupabaseClient,
    organizationId: string,
    cutoff: string,
  ): Promise<number>;
  /** Removes or redacts them, returning how many. Batched by the caller. */
  apply(
    db: SupabaseClient,
    organizationId: string,
    cutoff: string,
    action: "delete" | "anonymise",
    limit: number,
  ): Promise<number>;
}

/**
 * The common case: delete rows older than the cutoff, in batches.
 *
 * PostgREST has no LIMIT on a delete, so the ids are selected first and then
 * deleted by id. That is also what makes the pass safe to interrupt — each
 * batch is its own statement, and a run that dies halfway has simply done
 * less work rather than a partial, inconsistent amount.
 */
function deleteOlderThan(table: string, column = "created_at"): SubjectHandler {
  return {
    async count(db, organizationId, cutoff) {
      const { count, error } = await db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .lt(column, cutoff);
      if (error) throw new Error(`could not count ${table}: ${error.message}`);
      return count ?? 0;
    },

    async apply(db, organizationId, cutoff, action, limit) {
      if (action !== "delete") {
        throw new Error(`${table} can only be deleted, not ${action}`);
      }
      const { data: doomed, error: selectError } = await db
        .from(table)
        .select("id")
        .eq("organization_id", organizationId)
        .lt(column, cutoff)
        .limit(limit);
      if (selectError) {
        throw new Error(`could not read ${table}: ${selectError.message}`);
      }
      const ids = (doomed ?? []).map((row) => row.id as string);
      if (ids.length === 0) return 0;

      const { error } = await db.from(table).delete().in("id", ids);
      if (error) throw new Error(`could not delete from ${table}: ${error.message}`);
      return ids.length;
    },
  };
}

/**
 * CRM notes are the one subject that can be redacted instead of removed.
 *
 * Deleting the row would erase the fact that contact happened at all, which is
 * the part relationship continuity actually needs. Anonymising keeps the date,
 * the organization and the type, and drops what was said.
 */
const crmInteraction: SubjectHandler = {
  ...deleteOlderThan("crm_interaction", "occurred_at"),

  async apply(db, organizationId, cutoff, action, limit) {
    if (action === "delete") {
      return deleteOlderThan("crm_interaction", "occurred_at").apply(
        db,
        organizationId,
        cutoff,
        action,
        limit,
      );
    }

    const { data: stale, error: selectError } = await db
      .from("crm_interaction")
      .select("id")
      .eq("organization_id", organizationId)
      .lt("occurred_at", cutoff)
      .neq("summary", REDACTED)
      .limit(limit);
    if (selectError) {
      throw new Error(`could not read crm_interaction: ${selectError.message}`);
    }
    const ids = (stale ?? []).map((row) => row.id as string);
    if (ids.length === 0) return 0;

    const { error } = await db
      .from("crm_interaction")
      .update({ summary: REDACTED, next_steps: null, contact_id: null })
      .in("id", ids);
    if (error) {
      throw new Error(`could not anonymise crm_interaction: ${error.message}`);
    }
    return ids.length;
  },

  async count(db, organizationId, cutoff) {
    // Rows already redacted are not counted again; otherwise the preview would
    // promise to remove the same notes every night forever.
    const { count, error } = await db
      .from("crm_interaction")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .lt("occurred_at", cutoff)
      .neq("summary", REDACTED);
    if (error) {
      throw new Error(`could not count crm_interaction: ${error.message}`);
    }
    return count ?? 0;
  },
};

/** What an anonymised note says. `summary` is NOT NULL, so it needs a value. */
export const REDACTED = "Redacted by retention policy.";

export const SUBJECT_HANDLERS: Record<string, SubjectHandler> = {
  activity_event: deleteOlderThan("activity_event"),
  notification: deleteOlderThan("notification"),
  crm_interaction: crmInteraction,
  export_job: deleteOlderThan("export_job"),
  audit_event: deleteOlderThan("audit_event"),
};

export const SUBJECT_KEYS = Object.keys(SUBJECT_HANDLERS);

/** The cutoff a policy of `retainDays` implies, as an ISO timestamp. */
export function cutoffFor(retainDays: number, now: Date): string {
  return new Date(now.getTime() - retainDays * 86_400_000).toISOString();
}
