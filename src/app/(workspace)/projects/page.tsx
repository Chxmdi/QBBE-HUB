import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge, StageBadge } from "@/components/shared/status-badges";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectCreateDialog } from "@/features/projects/components/project-create-dialog";
import { CreateFromTemplateButton } from "@/features/projects/components/create-from-template";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { createProjectTemplate } from "@/features/admin/services/workflow.commands";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import type { Project } from "@/types/entities";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; stage?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("project")
    .select(
      "id, program_id, name, outcome, stage, health, health_reason, start_date, target_date, created_at, archived_at, owner_id, description, " +
        "owner:owner_id(id, full_name, email, avatar_url, title, timezone), program:program_id(id, name)",
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (params.stage) query = query.eq("stage", params.stage);

  const [{ data: projects }, options, { data: programs }, { data: templates }] = await Promise.all([
    query,
    getPickerOptions(),
    supabase.from("program").select("id, name").eq("status", "active").order("name"),
    supabase.from("project_template").select("id, name").order("name"),
  ]);

  const projectList = (projects ?? []) as unknown as Project[];

  return (
    <div>
      <PageHeader
        eyebrow="Portfolio"
        title="Projects"
        description="Every project keeps one accountable owner, a stage, health, and a target date."
        actions={
          session.isStaff ? (
            <div className="flex flex-wrap items-center gap-2">
              <CreateFromTemplateButton
                templates={(templates ?? []) as { id: string; name: string }[]}
              />
              <EntityFormDialog
                triggerLabel="Save template"
                triggerVariant="secondary"
                title="Project template"
                submitLabel="Save"
                action={createProjectTemplate}
                fields={[
                  { name: "name", label: "Name", type: "text", required: true },
                  { name: "outcome", label: "Default outcome", type: "textarea" },
                ]}
              />
              <ProjectCreateDialog
                programs={(programs ?? []).map((p) => ({ id: p.id, label: p.name }))}
                people={options.people}
                defaultOpen={params.create === "1"}
              />
            </div>
          ) : undefined
        }
      />

      {projectList.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="Your first program starts here"
          description="A project brings tasks, meetings, communication, and reporting together around one clear outcome with an accountable owner."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-soft/60">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Project</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Program</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Owner</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Stage</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Health</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Target</th>
                </tr>
              </thead>
              <tbody>
                {projectList.map((project) => (
                  <tr key={project.id} className="interactive-row border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium hover:text-brand-fg"
                      >
                        {project.name}
                      </Link>
                      {project.outcome ? (
                        <p className="meta max-w-md truncate">{project.outcome}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {project.program?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {project.owner ? (
                        <span className="flex items-center gap-2">
                          <Avatar
                            name={project.owner.full_name}
                            src={project.owner.avatar_url}
                            size="sm"
                          />
                          <span className="whitespace-nowrap">
                            {project.owner.full_name}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge stage={project.stage} />
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge health={project.health} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDate(project.target_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
