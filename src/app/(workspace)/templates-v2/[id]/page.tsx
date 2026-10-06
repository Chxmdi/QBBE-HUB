import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { canCreateWorkspacePages, canEditPage } from "@/features/pages/access";
import { getPagesT } from "@/features/pages/i18n/server";
import { PAGE_COLUMNS, toPageRow, type PageRecordRow } from "@/features/pages/services/page.queries";
import { liveRows } from "@/features/pages/tree";
import { TemplateUse } from "@/features/templates-v2/components/template-use";
import type { ParentOption } from "@/features/templates-v2/components/page-template-form";
import { requireTemplatesV2 } from "@/features/templates-v2/gate";
import { templatesV2Text } from "@/features/templates-v2/messages";
import type { TemplateRecord } from "@/features/templates-v2/template";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { calendarDateInZone, DEFAULT_TIME_ZONE } from "@/lib/time";

export async function generateMetadata(): Promise<Metadata> {
  return { title: templatesV2Text(await getLocale()).title };
}
export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireTemplatesV2();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireSession();
  const locale = await getLocale();
  const text = templatesV2Text(locale);
  const fr = locale === "fr-CA";
  const supabase = await createSupabasePageClient();
  const { data: row } = await supabase
    .from("template_v2")
    .select("id, scope, type_key, name_en, name_fr, description_en, description_fr, body")
    .eq("id", id)
    .maybeSingle();
  if (!row) notFound();
  const [{ data: programs }, { data: projects }] = await Promise.all([
    supabase.from("program").select("id, name").order("name").limit(500),
    supabase.from("project").select("id, name").is("archived_at", null).order("name").limit(500),
  ]);
  const template: TemplateRecord = { id: row.id, scope: row.scope, typeKey: row.type_key, body: row.body };
  const today =
    calendarDateInZone(new Date(), session.timeZone ?? DEFAULT_TIME_ZONE) ?? new Date().toISOString().slice(0, 10);

  // A page template needs the pages module: the places this person may put a page.
  const viewer = { userId: session.userId, role: session.role };
  const pagesEnabled = template.scope === "page" && (await isEnabled("wos_pages"));
  let parents: ParentOption[] = [];
  if (pagesEnabled) {
    const { data: pages } = await supabase.from("page").select(PAGE_COLUMNS).order("title");
    parents = liveRows(((pages ?? []) as PageRecordRow[]).map(toPageRow))
      .filter((page) => canEditPage(viewer, page))
      .map((page) => ({ id: page.id, title: page.title, visibility: page.visibility }));
  }
  const pagesT = await getPagesT();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={text.title}
        title={fr ? row.name_fr : row.name_en}
        description={(fr ? row.description_fr : row.description_en) ?? undefined}
      />
      <TemplateUse
        template={template}
        text={text}
        locale={locale === "fr-CA" ? "fr-CA" : "en"}
        today={today}
        programs={(programs ?? []) as { id: string; name: string }[]}
        projects={(projects ?? []) as { id: string; name: string }[]}
        pagesEnabled={pagesEnabled}
        parents={parents}
        canCreateWorkspace={canCreateWorkspacePages(viewer)}
        untitled={pagesT("page.untitled")}
      />
    </div>
  );
}
