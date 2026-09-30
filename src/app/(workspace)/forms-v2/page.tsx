import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardPen, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LegacyConversion } from "@/features/forms-v2/components/form-v2-admin-actions";
import { FORM_STATUS_TONE, requireFormsV2 } from "@/features/forms-v2/gate";
import { formsV2Text } from "@/features/forms-v2/messages";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: formsV2Text(await getLocale()).title };
}
export const dynamic = "force-dynamic";

interface FormRow {
  id: string;
  type_key: string;
  title_en: string;
  title_fr: string;
  description_en: string | null;
  description_fr: string | null;
  audience: "members" | "staff";
  status: keyof typeof FORM_STATUS_TONE;
  legacy_form_id: string | null;
}

export default async function FormsV2Page() {
  await requireFormsV2();
  const session = await requireSession();
  const locale = await getLocale();
  const text = formsV2Text(locale);
  const fr = locale === "fr-CA";
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("form_v2")
    .select("id, type_key, title_en, title_fr, description_en, description_fr, audience, status, legacy_form_id")
    .order("updated_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as FormRow[];
  const open = rows.filter((f) => f.status === "published");
  const title = (f: FormRow) => (fr ? f.title_fr : f.title_en);
  const statusText = { draft: text.statusDraft, published: text.statusPublished, closed: text.statusClosed };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.description}
        actions={
          session.isAdmin ? (
            <Link
              href="/forms-v2/new"
              className="inline-flex h-9.5 items-center gap-1.5 rounded-(--radius-sm) bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-strong"
            >
              <Plus className="size-4" aria-hidden />
              {text.newForm}
            </Link>
          ) : null
        }
      />

      <section aria-labelledby="forms-v2-open" className="space-y-3">
        <h2 id="forms-v2-open" className="text-[15px] font-semibold">
          {text.openHeading}
        </h2>
        {open.length === 0 ? (
          <EmptyState icon={<ClipboardPen />} title={text.noOpenForms} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {open.map((f) => (
              <li key={f.id} className="card p-4">
                <Link href={`/forms-v2/${f.id}`} className="font-medium text-brand-fg hover:underline">
                  {title(f)}
                </Link>
                {(fr ? f.description_fr : f.description_en) ? (
                  <p className="meta mt-1 line-clamp-2">{fr ? f.description_fr : f.description_en}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {session.isAdmin ? (
        <section aria-labelledby="forms-v2-all" className="space-y-3">
          <h2 id="forms-v2-all" className="text-[15px] font-semibold">
            {text.manageHeading}
          </h2>
          {rows.length === 0 ? (
            <p className="meta">{text.noForms}</p>
          ) : (
            <DataTable minWidth="640px">
              <TableHead>
                <TableHeader>{text.colForm}</TableHeader>
                <TableHeader>{text.colCreates}</TableHeader>
                <TableHeader>{text.colFor}</TableHeader>
                <TableHeader>{text.colStatus}</TableHeader>
              </TableHead>
              <tbody>
                {rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Link href={`/forms-v2/${f.id}`} className="font-medium text-brand-fg hover:underline">
                        {title(f)}
                      </Link>
                    </TableCell>
                    <TableCell>{f.type_key === "task" ? text.typeTask : f.type_key}</TableCell>
                    <TableCell>{f.audience === "staff" ? text.audienceStaff : text.audienceMembers}</TableCell>
                    <TableCell>
                      <Badge tone={FORM_STATUS_TONE[f.status]}>{statusText[f.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </DataTable>
          )}
          <h3 className="pt-4 text-[14px] font-semibold">{text.convertHeading}</h3>
          <LegacyConversion text={text} />
        </section>
      ) : null}
    </div>
  );
}
