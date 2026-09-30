import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateBuilder } from "@/features/templates-v2/components/template-builder";
import { requireTemplatesV2 } from "@/features/templates-v2/gate";
import { templatesV2Text } from "@/features/templates-v2/messages";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: templatesV2Text(await getLocale()).builderTitle };
}
export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await requireTemplatesV2();
  const session = await requireSession();
  if (!session.isStaff) redirect("/templates-v2");
  const text = templatesV2Text(await getLocale());
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={text.title} title={text.builderTitle} description={text.builderDescription} />
      <TemplateBuilder text={text} />
    </div>
  );
}
