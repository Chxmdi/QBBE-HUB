import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { TemplateCatalog } from "@/features/admin/components/template-catalog";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  const session = await requireAdminAal2();
  const supabase = await createSupabaseServerClient();
  const [{ data: projectTemplates }, { data: agendas }, { data: records }, { data: projects }] =
    await Promise.all([
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
      supabase.from("project").select("id, name").is("archived_at", null).order("name"),
    ]);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Templates"
        description="Drafts stay unused until an administrator approves them. Using one copies structure only."
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
