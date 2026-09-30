import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { ReviewDecision } from "@/features/workflows/components/review-and-signing";
import { fill, workflowMessages } from "@/features/workflows/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: workflowMessages(await getLocale()).review.title };
}
export const dynamic = "force-dynamic";

/**
 * A person's review asked for by a workflow (V1-12). The reviewer sees it
 * through RLS (workflow_review_reviewer_read); anyone else gets "not found".
 */
export default async function WorkflowReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  const session = await requireSession();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = await createSupabasePageClient();
  const { data } = await db
    .from("workflow_review")
    .select("id, instructions, status, comment, reviewer_id")
    .eq("id", id)
    .maybeSingle();
  const review = data as { id: string; instructions: string; status: string; comment: string | null; reviewer_id: string } | null;
  if (!review) notFound();

  const m = workflowMessages(await getLocale());
  const mine = review.reviewer_id === session.userId;
  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader eyebrow={m.review.eyebrow} title={m.review.title} />
      <section className="rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5" aria-labelledby="review-instructions">
        <h2 id="review-instructions" className="section-heading mb-2">{m.review.instructions}</h2>
        <p className="whitespace-pre-wrap text-sm text-ink">{review.instructions}</p>
      </section>
      {review.status === "pending" && mine ? (
        <ReviewDecision id={review.id} m={m} />
      ) : (
        <p className="text-sm text-ink">
          <Badge tone={review.status === "approved" ? "success" : review.status === "rejected" ? "danger" : "warning"}>
            {m.outcomes[review.status === "pending" ? "waiting" : review.status === "approved" ? "succeeded" : "failed"]}
          </Badge>{" "}
          {review.status !== "pending"
            ? fill(m.review.decided, { decision: review.status === "approved" ? m.review.approved : m.review.rejected })
            : null}
          {review.comment ? <span className="mt-2 block text-muted">{review.comment}</span> : null}
        </p>
      )}
    </div>
  );
}
