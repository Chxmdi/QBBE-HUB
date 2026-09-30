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
  submitter: { full_name: string | null } | null;
}

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
      .select("id, submitted_at, answers, object_type, object_id, submitter:submitted_by(full_name)")
      .eq("form_id", id)
      .order("submitted_at", { ascending: false })
      .limit(500),
  ]);
  if (!form) notFound();
  const properties = form.properties as FormV2Property[];
  const rows = (responses ?? []) as unknown as ResponseRow[];

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
                  <TableCell key={p.key}>{answerText(p, r.answers[p.key], locale)}</TableCell>
                ))}
                <TableCell>
                  {r.object_type === "task" ? (
                    <Link href={`/my-work?task=${r.object_id}`} className="text-brand-fg underline">
                      {text.typeTask}
                    </Link>
                  ) : (
                    r.object_type
                  )}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
