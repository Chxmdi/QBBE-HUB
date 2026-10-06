import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardPen, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("forms.title") };
}
export const dynamic = "force-dynamic";

const STATUS_BADGE = {
  draft: { tone: "neutral", label: "forms.statuses.draft" },
  published: { tone: "success", label: "forms.statuses.published" },
  closed: { tone: "warning", label: "forms.statuses.closed" },
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
  const [t, format] = await Promise.all([getT(), getFormatters()]);
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
        eyebrow={t("forms.eyebrow")}
        title={t("forms.title")}
        description={t("forms.description")}
        actions={
          session.isAdmin ? (
            <Link
              href="/forms/new"
              className="inline-flex h-9.5 items-center gap-1.5 rounded-(--radius-sm) bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand/90"
            >
              <Plus className="size-4" aria-hidden />
              {t("forms.newForm")}
            </Link>
          ) : null
        }
      />

      <section aria-labelledby="open-forms" className="space-y-3">
        <h2 id="open-forms" className="text-[15px] font-semibold">
          {t("forms.openHeading")}
        </h2>
        {open.length === 0 ? (
          <EmptyState icon={<ClipboardPen />} title={t("forms.emptyOpenTitle")} description={t("forms.emptyOpenDescription")} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {open.map((f) => (
              <li key={f.id} className="card p-4">
                <Link href={`/forms/${f.id}`} className="font-medium text-brand-fg hover:underline">
                  {f.title}
                </Link>
                {f.requires_signature ? (
                  <Badge tone="info" className="ml-2">
                    {t("forms.signatureNeeded")}
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
          {t("forms.yourSubmissions")}
        </h2>
        {submissions.length === 0 ? (
          <p className="meta">{t("forms.noSubmissionsYet")}</p>
        ) : (
          <DataTable minWidth="480px">
            <TableHead>
              <TableHeader>{t("forms.colForm")}</TableHeader>
              <TableHeader>{t("forms.colSubmitted")}</TableHeader>
            </TableHead>
            <tbody>
              {submissions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/forms/submissions/${s.id}`} className="text-brand-fg hover:underline">
                      {s.form?.title ?? t("forms.formFallback")}
                    </Link>
                  </TableCell>
                  <TableCell>{format.inZone(s.submitted_at, session.timeZone, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      {session.isAdmin ? (
        <section aria-labelledby="manage-forms" className="space-y-3">
          <h2 id="manage-forms" className="text-[15px] font-semibold">
            {t("forms.manage")}
          </h2>
          {rows.length === 0 ? (
            <p className="meta">{t("forms.noFormsYet")}</p>
          ) : (
            <DataTable minWidth="640px">
              <TableHead>
                <TableHeader>{t("forms.colForm")}</TableHeader>
                <TableHeader>{t("forms.colFor")}</TableHeader>
                <TableHeader>{t("forms.colStatus")}</TableHeader>
                <TableHeader>{t("forms.colUpdated")}</TableHeader>
              </TableHead>
              <tbody>
                {rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Link href={`/forms/${f.id}`} className="font-medium text-brand-fg hover:underline">
                        {f.title}
                      </Link>
                    </TableCell>
                    <TableCell>{f.audience === "staff" ? t("forms.audienceStaff") : t("forms.audienceAll")}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_BADGE[f.status].tone}>{t(STATUS_BADGE[f.status].label)}</Badge>
                    </TableCell>
                    <TableCell>{format.inZone(f.updated_at, session.timeZone, { dateStyle: "medium" })}</TableCell>
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
