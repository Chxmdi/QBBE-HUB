import type { JobContext, JobResult } from "../runner";
import {
  summarizeRegister,
  type RegisterRow,
} from "@/features/record-retention/schemas";

/**
 * Reports, per organization, the classified records whose retention period
 * has ended and are not under legal hold.
 *
 * It never deletes. Disposing of a business record is a person's decision,
 * made with the accountant's confirmation in hand; this pass only makes the
 * list visible on Admin → Records & holds. The database would refuse a
 * deletion inside the period anyway, but a report that could delete would be
 * one bug away from doing so the day the period ends.
 */
export async function reportRecordRetention({
  db,
  definition,
}: JobContext): Promise<JobResult> {
  const { data: organizations, error } = await db
    .from("organization")
    .select("id")
    .limit(definition.batch_size);
  if (error) throw new Error(`could not read organizations: ${error.message}`);

  let processed = 0;
  let failed = 0;
  let pastRetention = 0;

  for (const organization of (organizations ?? []) as { id: string }[]) {
    const { data, error: registerError } = await db.rpc("record_retention_register", {
      p_organization: organization.id,
    });
    if (registerError) {
      failed += 1;
      continue;
    }
    const summary = summarizeRegister((data ?? []) as RegisterRow[]);
    const { error: insertError } = await db.from("record_retention_report").insert({
      organization_id: organization.id,
      past_retention_count: summary.pastRetention,
      held_count: summary.held,
      by_category: summary.byCategory,
    });
    if (insertError) {
      failed += 1;
      continue;
    }
    processed += 1;
    pastRetention += summary.pastRetention;
  }

  return { processed, failed, metadata: { past_retention: pastRetention } };
}
