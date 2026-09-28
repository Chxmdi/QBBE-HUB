import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { FormAdminActions } from "@/features/forms/components/form-admin-actions";
import { FormFill } from "@/features/forms/components/form-fill";
import { FIELD_TYPE_KEYS, type FormField } from "@/features/forms/fields";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("forms.detail.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createSupabasePageClient();
  const { data: form } = await supabase
    .from("form_definition")
    .select("id, title, description, audience, requires_signature, status, fields")
    .eq("id", id)
    .maybeSingle();
  if (!form) notFound();
  const fields = form.fields as FormField[];
  const status = form.status as "draft" | "published" | "closed";
  const t = await getT();

  return (
    <div>
      <Breadcrumbs items={[{ label: t("forms.title"), href: "/forms" }, { label: form.title }]} />
      <PageHeader
        eyebrow={form.audience === "staff" ? t("forms.detail.staffEyebrow") : t("forms.detail.eyebrow")}
        title={form.title}
        description={form.description ?? undefined}
        actions={session.isAdmin ? <FormAdminActions formId={form.id} status={status} /> : null}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {status === "draft" ? <Badge>{t("forms.detail.draftBadge")}</Badge> : null}
        {status === "closed" ? <Badge tone="warning">{t("forms.detail.closedBadge")}</Badge> : null}
        {form.requires_signature ? <Badge tone="info">{t("forms.detail.mustBeSigned")}</Badge> : null}
      </div>

      {status === "published" ? (
        <FormFill
          formId={form.id}
          fields={fields}
          requiresSignature={form.requires_signature}
          organizationId={session.organizationId}
          userId={session.userId}
        />
      ) : status === "draft" ? (
        <section aria-labelledby="preview" className="card max-w-2xl p-4">
          <h2 id="preview" className="mb-3 text-[15px] font-semibold">
            {t("forms.detail.questions")}
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-[14px]">
            {fields.map((f) => (
              <li key={f.key}>
                <span className="font-medium">{f.label}</span>{" "}
                <span className="meta">
                  {t(FIELD_TYPE_KEYS[f.type])}
                  {f.required ? t("forms.detail.requiredSuffix") : ""}
                  {f.options?.length ? `: ${f.options.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="meta">{t("forms.detail.closedNote")}</p>
      )}
    </div>
  );
}
