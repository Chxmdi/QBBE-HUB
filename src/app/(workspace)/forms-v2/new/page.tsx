import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { FormV2Builder } from "@/features/forms-v2/components/form-v2-builder";
import { requireFormsV2 } from "@/features/forms-v2/gate";
import { formsV2Text } from "@/features/forms-v2/messages";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: formsV2Text(await getLocale()).builderTitle };
}
export const dynamic = "force-dynamic";

export default async function NewFormV2Page() {
  await requireFormsV2();
  const session = await requireSession();
  if (!session.isAdmin) redirect("/forms-v2");
  const locale = await getLocale();
  const text = formsV2Text(locale);
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("project")
    .select("id, name")
    .is("archived_at", null)
    .order("name")
    .limit(500);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={text.title} title={text.builderTitle} description={text.builderDescription} />
      <FormV2Builder text={text} locale={locale} projects={(data ?? []) as { id: string; name: string }[]} />
    </div>
  );
}
