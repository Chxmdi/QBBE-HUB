import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Inbox } from "lucide-react";
import { z } from "zod";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { answerText, type FormField } from "@/features/forms/fields";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { formatInZone } from "@/lib/time";

export const metadata: Metadata = { title: "Form submissions" };
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 500;
// The table shows the first few answers; the CSV carries all of them.
const SHOWN_FIELDS = 4;

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminAal2();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createSupabasePageClient();
  const [{ data: form }, { data: submissions }] = await Promise.all([
    supabase.from("form_definition").select("id, title, fields, requires_signature").eq("id", id).maybeSingle(),
    supabase
      .from("form_submission")
      .select("id, submitted_at, answers, submitter:submitted_by(full_name), signature(id)")
      .eq("form_id", id)
      .order("submitted_at", { ascending: false })
      .limit(PAGE_LIMIT),
  ]);
  if (!form) notFound();
  const fields = (form.fields as FormField[]).filter((f) => f.type !== "file").slice(0, SHOWN_FIELDS);
  const rows = (submissions ?? []) as unknown as {
    id: string;
    submitted_at: string;
    answers: Record<string, unknown>;
    submitter: { full_name: string } | null;
    signature: { id: string }[];
  }[];

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Forms", href: "/forms" },
          { label: form.title, href: `/forms/${id}` },
          { label: "Submissions" },
        ]}
      />
      <PageHeader
        eyebrow="Forms"
        title={`Submissions: ${form.title}`}
        actions={
          <Link
            href={`/api/forms/${id}/export`}
            prefetch={false}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Export CSV
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Inbox />} title="No submissions yet" />
      ) : (
        <>
          <p className="meta mb-2">
            {rows.length === PAGE_LIMIT ? `Showing the latest ${PAGE_LIMIT}. ` : ""}
            {rows.length} {rows.length === 1 ? "submission" : "submissions"}.
          </p>
          <DataTable minWidth="720px">
            <TableHead>
              <TableHeader>Submitted</TableHeader>
              <TableHeader>By</TableHeader>
              {fields.map((f) => (
                <TableHeader key={f.key}>{f.label}</TableHeader>
              ))}
              {form.requires_signature ? <TableHeader>Signed</TableHeader> : null}
            </TableHead>
            <tbody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/forms/submissions/${s.id}`} className="text-brand-fg hover:underline">
                      {formatInZone(s.submitted_at, session.timeZone, { dateStyle: "medium", timeStyle: "short" })}
                    </Link>
                  </TableCell>
                  <TableCell>{s.submitter?.full_name ?? "—"}</TableCell>
                  {fields.map((f) => (
                    <TableCell key={f.key} className="max-w-60 truncate">
                      {answerText(f, s.answers[f.key])}
                    </TableCell>
                  ))}
                  {form.requires_signature ? (
                    <TableCell>
                      {s.signature.length > 0 ? <Badge tone="success">Signed</Badge> : <Badge tone="warning">Not signed</Badge>}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </div>
  );
}
