import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardPen, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { formatInZone } from "@/lib/time";

export const metadata: Metadata = { title: "Forms" };
export const dynamic = "force-dynamic";

const STATUS_BADGE = {
  draft: { tone: "neutral", label: "Draft" },
  published: { tone: "success", label: "Open" },
  closed: { tone: "warning", label: "Closed" },
} as const;

interface FormRow {
  id: string;
  title: string;
  description: string | null;
  audience: "members" | "staff";
  requires_signature: boolean;
  status: keyof typeof STATUS_BADGE;
  updated_at: string;
}

export default async function FormsPage() {
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  const [{ data: forms }, { data: mine }] = await Promise.all([
    supabase
      .from("form_definition")
      .select("id, title, description, audience, requires_signature, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("form_submission")
      .select("id, submitted_at, form:form_id(title)")
      .eq("submitted_by", session.userId)
      .order("submitted_at", { ascending: false })
      .limit(100),
  ]);
  const rows = (forms ?? []) as FormRow[];
  const open = rows.filter((f) => f.status === "published");
  const submissions = (mine ?? []) as unknown as {
    id: string;
    submitted_at: string;
    form: { title: string } | null;
  }[];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Paperless"
        title="Forms"
        description="Fill in the organization's forms here instead of on paper. Each submission is kept with who sent it and when, and cannot be changed afterwards."
        actions={
          session.isAdmin ? (
            <Link
              href="/forms/new"
              className="inline-flex h-9.5 items-center gap-1.5 rounded-(--radius-sm) bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand/90"
            >
              <Plus className="size-4" aria-hidden />
              New form
            </Link>
          ) : null
        }
      />

      <section aria-labelledby="open-forms" className="space-y-3">
        <h2 id="open-forms" className="text-[15px] font-semibold">
          Forms you can fill in
        </h2>
        {open.length === 0 ? (
          <EmptyState icon={<ClipboardPen />} title="No open forms" description="Forms appear here once an administrator publishes them." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {open.map((f) => (
              <li key={f.id} className="card p-4">
                <Link href={`/forms/${f.id}`} className="font-medium text-brand-fg hover:underline">
                  {f.title}
                </Link>
                {f.requires_signature ? (
                  <Badge tone="info" className="ml-2">
                    Signature needed
                  </Badge>
                ) : null}
                {f.description ? <p className="meta mt-1 line-clamp-2">{f.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-submissions" className="space-y-3">
        <h2 id="my-submissions" className="text-[15px] font-semibold">
          Your submissions
        </h2>
        {submissions.length === 0 ? (
          <p className="meta">You have not submitted any forms yet.</p>
        ) : (
          <DataTable minWidth="480px">
            <TableHead>
              <TableHeader>Form</TableHeader>
              <TableHeader>Submitted</TableHeader>
            </TableHead>
            <tbody>
              {submissions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/forms/submissions/${s.id}`} className="text-brand-fg hover:underline">
                      {s.form?.title ?? "Form"}
                    </Link>
                  </TableCell>
                  <TableCell>{formatInZone(s.submitted_at, session.timeZone, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      {session.isAdmin ? (
        <section aria-labelledby="manage-forms" className="space-y-3">
          <h2 id="manage-forms" className="text-[15px] font-semibold">
            Manage forms
          </h2>
          {rows.length === 0 ? (
            <p className="meta">No forms yet. Use New form to make one.</p>
          ) : (
            <DataTable minWidth="640px">
              <TableHead>
                <TableHeader>Form</TableHeader>
                <TableHeader>For</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Updated</TableHeader>
              </TableHead>
              <tbody>
                {rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Link href={`/forms/${f.id}`} className="font-medium text-brand-fg hover:underline">
                        {f.title}
                      </Link>
                    </TableCell>
                    <TableCell>{f.audience === "staff" ? "Staff" : "All members"}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_BADGE[f.status].tone}>{STATUS_BADGE[f.status].label}</Badge>
                    </TableCell>
                    <TableCell>{formatInZone(f.updated_at, session.timeZone, { dateStyle: "medium" })}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      ) : null}
    </div>
  );
}
