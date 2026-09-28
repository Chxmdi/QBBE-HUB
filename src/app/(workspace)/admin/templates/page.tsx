import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { TemplateCatalog } from "@/features/admin/components/template-catalog";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.templates.title") };
}
export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  const session = await requireAdminAal2();
  const t = await getT();
  const supabase = await createSupabasePageClient();
  const [
    { data: projectTemplates },
    { data: agendas },
    { data: records },
    { data: projects },
  ] = await Promise.all([
    supabase
      .from("project_template")
      .select("id, name, approved_at")
      .eq("organization_id", session.organizationId)
      .order("name"),
    supabase
      .from("agenda_template")
      .select("id, name, approved_at")
      .eq("organization_id", session.organizationId)
      .order("name"),
    supabase
      .from("record_template")
      .select("id, name, kind, approved_at")
      .eq("organization_id", session.organizationId)
      .order("name"),
    supabase
      .from("project")
      .select("id, name")
      .is("archived_at", null)
      .order("name"),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.templates.title")}
        description={t("admin.templates.description")}
      />
      <AdminNav />
      <TemplateCatalog
        projectTemplates={projectTemplates ?? []}
        agendas={agendas ?? []}
        records={records ?? []}
        projects={projects ?? []}
      />
    </div>
  );
}
