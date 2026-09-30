import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { BlueprintDesigner } from "@/features/blueprints/components/blueprint-designer";
import { blueprintsMessages } from "@/features/blueprints/i18n";
import { getBlueprint, liveBuild } from "@/features/blueprints/services/blueprint.queries";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: blueprintsMessages(await getLocale()).title };
}

export default async function BlueprintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  if (!(await isEnabled("wos_objects", supabase)) || !session.isStaff) notFound();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const blueprint = await getBlueprint(supabase, id);
  if (!blueprint) notFound();
  const build = blueprint.status === "built" ? await liveBuild(supabase, id) : null;
  const locale = await getLocale();
  const messages = blueprintsMessages(locale);

  return (
    <div>
      <PageHeader
        eyebrow={messages.title}
        title={locale === "fr-CA" ? blueprint.nameFr : blueprint.nameEn}
      />
      <BlueprintDesigner
        key={blueprint.id}
        id={blueprint.id}
        initial={blueprint.definition}
        status={blueprint.status}
        approvedAt={blueprint.approvedAt}
        build={build}
        canEdit={session.isAdmin}
        messages={messages}
        locale={locale}
      />
    </div>
  );
}
