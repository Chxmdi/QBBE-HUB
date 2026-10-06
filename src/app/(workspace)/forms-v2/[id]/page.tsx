import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { FormV2StatusActions } from "@/features/forms-v2/components/form-v2-admin-actions";
import { FormV2Fill } from "@/features/forms-v2/components/form-v2-fill";
import { FORM_STATUS_TONE, requireFormsV2 } from "@/features/forms-v2/gate";
import { formsV2Text } from "@/features/forms-v2/messages";
import type { FormV2Property } from "@/features/forms-v2/properties";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: formsV2Text(await getLocale()).title };
}
export const dynamic = "force-dynamic";

export default async function FormV2Page({ params }: { params: Promise<{ id: string }> }) {
  await requireFormsV2();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireSession();
  const locale = await getLocale();
  const text = formsV2Text(locale);
  const fr = locale === "fr-CA";
  const supabase = await createSupabasePageClient();
  const { data: form } = await supabase
    .from("form_v2")
    .select("id, type_key, title_en, title_fr, description_en, description_fr, status, properties, legacy_form_id")
    .eq("id", id)
    .maybeSingle();
  if (!form) notFound();
  const status = form.status as keyof typeof FORM_STATUS_TONE;
  const statusText = { draft: text.statusDraft, published: text.statusPublished, closed: text.statusClosed };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={text.title}
        title={fr ? form.title_fr : form.title_en}
        description={(fr ? form.description_fr : form.description_en) ?? undefined}
        actions={
          session.isAdmin ? (
            <Link href={`/forms-v2/${id}/responses`} className="text-sm text-brand-fg underline">
              {text.responsesHeading}
            </Link>
          ) : null
        }
      />
      {session.isAdmin ? (
        <div className="card flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="space-y-1">
            <Badge tone={FORM_STATUS_TONE[status]}>{statusText[status]}</Badge>
            {form.legacy_form_id && status === "draft" ? <p className="meta">{text.convertedFromLegacy}</p> : null}
          </div>
          <FormV2StatusActions formId={id} status={status} text={text} />
        </div>
      ) : null}
      {status === "published" ? (
        <FormV2Fill formId={id} properties={form.properties as FormV2Property[]} text={text} locale={locale} />
      ) : (
        <p className="meta">{status === "draft" ? text.draftNotice : text.closedNotice}</p>
      )}
    </div>
  );
}
