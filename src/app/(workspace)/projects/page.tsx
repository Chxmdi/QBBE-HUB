import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge } from "@/components/shared/status-badges";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectCreateDialog } from "@/features/projects/components/project-create-dialog";
import { CreateFromTemplateButton } from "@/features/projects/components/create-from-template";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import {
  createProjectTemplate,
  listProjectTemplates,
} from "@/features/admin/services/workflow.commands";
import { ProjectTemplateManager } from "@/features/projects/components/project-template-manager";
import { PortfolioFilters } from "@/features/dashboard/components/portfolio-filters";
import { parsePortfolioFilters } from "@/features/dashboard/portfolio";
import { getPortfolio, listPortfolioViews } from "@/features/dashboard/services/portfolio.queries";
import { SaveViewButton } from "@/features/tasks/components/save-view-button";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const archived = params.archived === "1";
  const views = await listPortfolioViews();
  const selectedView = views.find((view) => view.id === (Array.isArray(params.view) ? params.view[0] : params.view));
  const filters = parsePortfolioFilters({
    ...(selectedView?.query ?? {}),
    ...params,
    ...(archived ? { status: "archived" } : {}),
  });

  const [portfolio, options, { data: programs }, templateStructures, { data: funders }] = await Promise.all([
    getPortfolio({
      userId: session.userId,
      role: session.role,
      filters,
    }),
    getPickerOptions(),
    supabase.from("program").select("id, name").eq("status", "active").order("name"),
    listProjectTemplates(),
    supabase
      .from("crm_organization")
      .select("id, name")
      .in("category", ["funder", "sponsor", "donor", "government"])
      .eq("status", "active")
      .order("name"),
  ]);
  const templates = templateStructures.map((t) => ({ id: t.id, name: t.name }));
  const projectList = portfolio.rows;

  return (
    <div>
      <PageHeader
        eyebrow="Portfolio"
        title="Projects"
        description="Every project keeps one accountable owner, a stage, health, and a target date."
        actions={
          session.isStaff ? (
            <div className="flex flex-wrap items-center gap-2">
              <CreateFromTemplateButton templates={templates} />
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
                funders={((funders ?? []) as { id: string; name: string }[]).map((funder) => ({
                  id: funder.id,
                  label: funder.name,
                }))}
                defaultOpen={params.create === "1"}
              />
            </div>
          ) : undefined
        }
      />

      <nav aria-label="Project archive" className="mb-6 flex gap-4 text-sm">
        <Link
          href="/projects"
          aria-current={!archived ? "page" : undefined}
          className="hover:underline"
        >
          Current projects
        </Link>
        <Link
          href="/projects?archived=1"
          aria-current={archived ? "page" : undefined}
          className="hover:underline"
        >
          Archived projects
        </Link>
      </nav>

      <p className="meta mb-3">Last refreshed {formatDateTime(portfolio.refreshedAt)}</p>
      {views.length > 0 ? (
        <nav aria-label="Saved views" className="mb-3 flex flex-wrap gap-2">
          {views.map((view) => (
            <Link key={view.id} href={`/projects?view=${view.id}`} className="text-[13px] hover:underline">
              {view.name}
              {view.shared ? " · shared" : ""}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <PortfolioFilters
          filters={filters}
          programs={(programs ?? []) as { id: string; name: string }[]}
          people={options.people}
          funders={(funders ?? []) as { id: string; name: string }[]}
        />
        <SaveViewButton path="/projects" />
      </div>

      {projectList.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title={archived ? "No archived projects" : "Your first program starts here"}
          description={
            archived
              ? "Archived projects stay here so they can be reviewed and restored."
              : "A project brings tasks, meetings, communication, and reporting together around one clear outcome with an accountable owner."
          }
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
                  <th scope="col" className="px-4 py-2.5 font-semibold">Health</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Progress</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Next milestone</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Target</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Main blocker</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Last update</th>
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
                      {project.stale ? <p className="meta">Stale</p> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{project.programName ?? "—"}</td>
                    <td className="px-4 py-3">
                      {project.ownerName ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={project.ownerName} size="sm" />
                          <span className="whitespace-nowrap">{project.ownerName}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge health={project.health} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{project.progressPercent}%</td>
                    <td className="px-4 py-3 text-muted">{project.nextMilestone ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDate(project.targetDate)}
                    </td>
                    <td className="max-w-48 truncate px-4 py-3 text-muted">
                      {project.mainBlocker ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDate(project.lastUpdateAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {session.isStaff && !archived ? (
        <ProjectTemplateManager templates={templateStructures} />
      ) : null}
    </div>
  );
}
