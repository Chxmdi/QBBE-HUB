import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { FormBuilder } from "@/features/forms/components/form-builder";
import { requireAdminAal2 } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("forms.newForm") };
}
export const dynamic = "force-dynamic";

export default async function NewFormPage() {
  await requireAdminAal2();
  const t = await getT();
  return (
    <div>
      <Breadcrumbs items={[{ label: t("forms.title"), href: "/forms" }, { label: t("forms.newForm") }]} />
      <PageHeader
        eyebrow={t("forms.title")}
        title={t("forms.newForm")}
        description={t("forms.newPage.description")}
      />
      <FormBuilder />
    </div>
  );
}
