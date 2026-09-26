import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { OpenFileButton } from "@/features/forms/components/open-file-button";
import { SignatureRecord, type SignatureRow } from "@/features/forms/components/signature-record";
import { answerText, type FormField } from "@/features/forms/fields";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { formatInZone } from "@/lib/time";

export const metadata: Metadata = { title: "Form submission" };
export const dynamic = "force-dynamic";

type ScanStatus = "pending" | "clean" | "quarantined" | "rejected";

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createSupabasePageClient();
  const { data: submission } = await supabase
    .from("form_submission")
    .select(
      "id, form_id, submitted_at, answers, content_sha256, submitter:submitted_by(full_name), " +
        "form:form_id(id, title, fields, requires_signature)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!submission) notFound();
  const row = submission as unknown as {
    id: string;
    submitted_at: string;
    answers: Record<string, unknown>;
    content_sha256: string;
    submitter: { full_name: string } | null;
    form: { id: string; title: string; fields: FormField[]; requires_signature: boolean };
  };

  const [{ data: files }, { data: signatures }, { data: verification }] = await Promise.all([
    supabase
      .from("form_file")
      .select("id, field_key, file_name, scan_status, content_sha256")
      .eq("submission_id", id),
    supabase
      .from("signature")
      .select("id, signer_name, signer_email, signed_at, consent_statement, content_sha256")
      .eq("form_submission_id", id)
      .order("signed_at"),
    supabase.rpc("verify_form_submission", { p_submission_id: id }),
  ]);
  const fileByKey = new Map(
    ((files ?? []) as { id: string; field_key: string; file_name: string; scan_status: ScanStatus; content_sha256: string | null }[])
      .map((f) => [f.field_key, f]),
  );
  const check = (verification as { recomputed_sha256: string; matches: boolean }[] | null)?.[0];

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Forms", href: "/forms" },
            { label: row.form.title, href: `/forms/${row.form.id}` },
            { label: "Submission" },
          ]}
        />
        <PageHeader
          eyebrow="Submission"
          title={row.form.title}
          description={`Submitted by ${row.submitter?.full_name ?? "a member"} on ${formatInZone(
            row.submitted_at,
            session.timeZone,
            { dateStyle: "long", timeStyle: "long" },
          )}. Submissions cannot be changed.`}
        />
      </div>

      <section aria-labelledby="answers" className="card p-4">
        <h2 id="answers" className="mb-3 text-[15px] font-semibold">
          Answers
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[minmax(10rem,16rem)_1fr]">
          {row.form.fields.map((f) => {
            const file = f.type === "file" ? fileByKey.get(f.key) : undefined;
            return (
              <div key={f.key} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd className="break-words whitespace-pre-wrap">
                  {file ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {file.file_name}
                      <OpenFileButton kind="form-file" id={file.id} fileName={file.file_name} scanStatus={file.scan_status} />
                    </span>
                  ) : (
                    answerText(f, row.answers[f.key]) || <span className="text-muted">No answer</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="meta mt-4">
          SHA-256 recorded at submission:{" "}
          <span className="font-mono text-[12px] break-all">{row.content_sha256}</span>
          {check ? (check.matches ? " (still matches)" : " (does not match what is stored now)") : null}
        </p>
      </section>

      {row.form.requires_signature || (signatures ?? []).length > 0 ? (
        <SignatureRecord
          signatures={(signatures ?? []) as SignatureRow[]}
          currentSha256={check?.recomputed_sha256 ?? null}
          timeZone={session.timeZone}
        />
      ) : null}
    </div>
  );
}
