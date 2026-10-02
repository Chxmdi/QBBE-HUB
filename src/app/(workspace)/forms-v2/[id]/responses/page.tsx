import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireFormsV2 } from "@/features/forms-v2/gate";
import { formsV2Text } from "@/features/forms-v2/messages";
import { answerText, localized, type FormV2Property } from "@/features/forms-v2/properties";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: formsV2Text(await getLocale()).responsesHeading };
}
export const dynamic = "force-dynamic";

interface ResponseRow {
  id: string;
  submitted_at: string;
  answers: Record<string, unknown>;
  object_type: string;
  object_id: string;
  created_object_type: string | null;
  created_object_id: string | null;
  submitter: { full_name: string | null } | null;
}

interface FileRow {
  id: string;
  title: string;
  scan_status: "pending" | "clean" | "quarantined" | "rejected";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FormV2ResponsesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFormsV2();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireSession();
  if (!session.isAdmin) redirect(`/forms-v2/${id}`);
  const locale = await getLocale();
  const [text, format] = [formsV2Text(locale), await getFormatters()];
  const supabase = await createSupabasePageClient();
  const [{ data: form }, { data: responses }] = await Promise.all([
    supabase.from("form_v2").select("title_en, title_fr, properties").eq("id", id).maybeSingle(),
    supabase
      .from("form_v2_response")
      .select(
        "id, submitted_at, answers, object_type, object_id, created_object_type, created_object_id, submitter:submitted_by(full_name)",
      )
      .eq("form_id", id)
      .order("submitted_at", { ascending: false })
      .limit(500),
  ]);
  if (!form) notFound();
  const properties = form.properties as FormV2Property[];
  const rows = (responses ?? []) as unknown as ResponseRow[];

  // File answers are document ids; show each by its title and scan state.
  const fileKeys = properties.filter((p) => p.kind === "file").map((p) => p.key);
  const fileIds = [...new Set(rows.flatMap((r) => fileKeys.map((k) => r.answers[k])).filter(
    (v): v is string => typeof v === "string" && UUID.test(v),
  ))];
  const files = new Map<string, FileRow>();
  if (fileIds.length > 0) {
    const { data } = await supabase.from("document").select("id, title, scan_status").in("id", fileIds);
    for (const f of (data ?? []) as FileRow[]) files.set(f.id, f);
  }
  const fileCell = (value: unknown) => {
    const f = typeof value === "string" ? files.get(value) : undefined;
    return f ? `${f.title} · ${text.scan[f.scan_status]}` : "";
  };
  const createdLink = (r: ResponseRow) => {
    const type = r.created_object_type ?? (r.object_type === "task" ? "task" : null);
    const id = r.created_object_id ?? (r.object_type === "task" ? r.object_id : null);
    if (!type || !id) return r.object_type;
    return (
      <Link href={type === "task" ? `/my-work?task=${id}` : `/objects/${id}`} className="text-brand-fg underline">
        {type === "task" ? text.typeTask : `${text.typeRecord}: ${type}`}
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={text.responsesHeading} title={locale === "fr-CA" ? form.title_fr : form.title_en} />
      {rows.length === 0 ? (
        <p className="meta">{text.noResponses}</p>
      ) : (
        <DataTable minWidth="640px">
          <TableHead>
            <TableHeader>{text.colSubmitted}</TableHeader>
            <TableHeader>{text.colBy}</TableHeader>
            {properties.map((p) => (
              <TableHeader key={p.key}>{localized(p.label, locale)}</TableHeader>
            ))}
            <TableHeader>{text.colRecord}</TableHeader>
          </TableHead>
          <tbody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{format.inZone(r.submitted_at, session.timeZone, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                <TableCell>{r.submitter?.full_name ?? ""}</TableCell>
                {properties.map((p) => (
                  <TableCell key={p.key}>
                    {p.kind === "file" ? fileCell(r.answers[p.key]) : answerText(p, r.answers[p.key], locale)}
                  </TableCell>
                ))}
                <TableCell>{createdLink(r)}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
