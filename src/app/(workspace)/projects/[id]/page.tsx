import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LinkTabs } from "@/components/shared/link-tabs";
import { HealthBadge } from "@/components/shared/status-badges";
import { CloseProjectDialog } from "@/features/projects/components/close-project-dialog";
import { CompleteMilestoneButton } from "@/features/projects/components/complete-milestone-button";
import { createMilestone } from "@/features/projects/services/milestone.commands";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { TaskDrawer } from "@/features/tasks/components/task-drawer";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { StageSelect } from "@/features/projects/components/stage-select";
import { StatusUpdateForm } from "@/features/projects/components/status-update-form";
import { TaskCreateDialog } from "@/features/tasks/components/task-create-dialog";
import { TaskRow } from "@/features/tasks/components/task-row";
import { TASK_SELECT, getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, relativeTime } from "@/lib/utils";
import { RaidLogPanel } from "@/features/risks/components/raid-log";
import { getRaidLog } from "@/features/risks/services/risk.queries";
import type {
  ActivityEvent,
  Milestone,
  Project,
  ProjectStatusUpdate,
  Task,
} from "@/types/entities";

export const metadata: Metadata = { title: "Project" };
export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireStaff();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam ?? "overview";
  const supabase = await createSupabaseServerClient();

  const { data: projectRow } = await supabase
    .from("project")
    .select(
      "id, program_id, name, outcome, description, stage, health, health_reason, start_date, target_date, created_at, archived_at, owner_id, " +
        "owner:owner_id(id, full_name, email, avatar_url, title, timezone), program:program_id(id, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!projectRow) notFound();
  const project = projectRow as unknown as Project;


  const [
    { data: milestones },
    { data: tasks },
    { data: updates },
    { data: activity },
    options,
    raidLog,
  ] = await Promise.all([
    supabase
      .from("milestone")
      .select("id, project_id, name, due_date, completed_at, sort_key")
      .eq("project_id", id)
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("task")
      .select(TASK_SELECT)
      .eq("project_id", id)
      .is("archived_at", null)
      .order("status")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from("project_status_update")
      .select(
        "id, project_id, author_id, health, progress_summary, next_steps, blockers, decisions_needed, help_requested, created_at, " +
          "author:author_id(id, full_name, email, avatar_url, title, timezone)",
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("activity_event")
      .select(
        "id, actor_id, verb, source_type, source_id, summary, created_at, actor:actor_id(id, full_name, email, avatar_url, title, timezone)",
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
    getPickerOptions(),
    getRaidLog(id),
  ]);

  const taskList = (tasks ?? []) as unknown as Task[];
  const openTasks = taskList.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled",
  );
  const doneTasks = taskList.filter((t) => t.status === "completed");

  return (
    <div>
      <div className="mb-2">
        <Link href="/projects" className="meta hover:text-brand-fg hover:underline">
          ← Projects
        </Link>
      </div>
      <PageHeader
        eyebrow={project.program?.name ?? "Independent project"}
        title={project.name}
        description={project.outcome ?? undefined}
        actions={
          session.isStaff ? (
            <>
              <StageSelect projectId={project.id} stage={project.stage} />
              {project.stage !== "completed" && project.stage !== "archived" ? (
                <CloseProjectDialog
                  projectId={project.id}
                  projectName={project.name}
                />
              ) : null}
              <TaskCreateDialog
                projects={[{ id: project.id, label: project.name }]}
                people={options.people}
                defaultProjectId={project.id}
                triggerLabel="Add task"
              />
            </>
          ) : undefined
        }
      />

      {/* Meta strip */}
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-(--radius-md) border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="meta">Owner</span>
          {project.owner ? (
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
              <Avatar name={project.owner.full_name} src={project.owner.avatar_url} size="sm" />
              {project.owner.full_name}
            </span>
          ) : (
            <span className="text-[13.5px] text-warning-fg">Unassigned</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="meta">Health</span>
          <HealthBadge health={project.health} />
        </div>
        {project.health_reason ? (
          <p className="text-[13px] text-warning-fg">{project.health_reason}</p>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="meta">Timeline</span>
          <span className="text-[13.5px]">
            {formatDate(project.start_date)} → {formatDate(project.target_date)}
          </span>
        </div>
      </div>

      <LinkTabs
        active={tab}
        tabs={[
          { id: "overview", label: "Overview", href: `/projects/${project.id}` },
          {
            id: "tasks",
            label: "Tasks",
            href: `/projects/${project.id}?tab=tasks`,
            count: openTasks.length,
          },
          {
            id: "updates",
            label: "Updates",
            href: `/projects/${project.id}?tab=updates`,
            count: (updates ?? []).length,
          },
          {
            id: "risks",
            label: "Risks & issues",
            href: `/projects/${project.id}?tab=risks`,
            count: raidLog.openCount,
          },
          {
            id: "activity",
            label: "Activity",
            href: `/projects/${project.id}?tab=activity`,
          },
        ]}
      />

      <div
        className={
          tab === "overview"
            ? "grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]"
            : "max-w-4xl"
        }
      >
        <div className="space-y-8">
          {/* Tasks */}
          <section
            aria-labelledby="project-tasks"
            className={tab === "overview" || tab === "tasks" ? "" : "hidden"}
          >
            <h2 id="project-tasks" className="section-heading mb-3">
              Tasks
              <span className="meta ml-2 font-normal">
                {openTasks.length} open · {doneTasks.length} done
              </span>
            </h2>
            {taskList.length === 0 ? (
              <EmptyState
                title="No tasks yet"
                description="Break the project into owned, dated tasks to make progress visible."
              />
            ) : (
              <div className="card overflow-hidden">
                {openTasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
                {doneTasks.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer border-t border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-medium text-muted">
                      Completed ({doneTasks.length})
                    </summary>
                    {doneTasks.map((task) => (
                      <TaskRow key={task.id} task={task} showStatusControl={false} />
                    ))}
                  </details>
                ) : null}
              </div>
            )}
          </section>

          {/* Status updates */}
          <section
            aria-labelledby="project-updates"
            className={tab === "overview" || tab === "updates" ? "" : "hidden"}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="project-updates" className="section-heading">
                Status updates
              </h2>
            </div>
            {session.isStaff ? (
              <div className="mb-4">
                <StatusUpdateForm projectId={project.id} />
              </div>
            ) : null}
            {(updates ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No status updates published yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {((updates ?? []) as unknown as ProjectStatusUpdate[]).map((update) => (
                  <li key={update.id} className="card p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {update.author ? (
                        <Avatar
                          name={update.author.full_name}
                          src={update.author.avatar_url}
                          size="sm"
                        />
                      ) : null}
                      <span className="text-[13px] font-medium">
                        {update.author?.full_name}
                      </span>
                      <HealthBadge health={update.health} />
                      <span className="meta ml-auto">
                        {relativeTime(update.created_at)}
                      </span>
                    </div>
                    <p className="text-[13.5px] whitespace-pre-wrap">
                      {update.progress_summary}
                    </p>
                    {update.next_steps ? (
                      <p className="mt-2 text-[13px]">
                        <span className="font-medium">Next:</span> {update.next_steps}
                      </p>
                    ) : null}
                    {update.blockers ? (
                      <p className="mt-1 text-[13px] text-danger-fg">
                        <span className="font-medium">Blockers:</span> {update.blockers}
                      </p>
                    ) : null}
                    {update.decisions_needed ? (
                      <p className="mt-1 text-[13px] text-warning-fg">
                        <span className="font-medium">Decisions needed:</span>{" "}
                        {update.decisions_needed}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className={tab === "overview" ? "space-y-8" : "hidden"}>
          {/* Milestones */}
          <section aria-labelledby="project-milestones">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="project-milestones" className="section-heading">
                Milestones
              </h2>
              {session.isStaff ? (
                <EntityFormDialog
                  triggerLabel="Add milestone"
                  triggerVariant="secondary"
                  title="Add milestone"
                  submitLabel="Create"
                  extraValues={{ projectId: project.id }}
                  action={createMilestone}
                  fields={[
                    { name: "name", label: "Name", type: "text", required: true },
                    { name: "dueDate", label: "Target date", type: "date" },
                  ]}
                />
              ) : null}
            </div>
            {(milestones ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No milestones defined.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {((milestones ?? []) as Milestone[]).map((m) => (
                  <li key={m.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    {m.completed_at ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success-fg" aria-label="Completed" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted/50" aria-label="Open" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      {m.name}
                    </span>
                    <span className="meta whitespace-nowrap">
                      {formatDate(m.due_date)}
                    </span>
                    {session.isStaff ? (
                      <CompleteMilestoneButton
                        milestoneId={m.id}
                        completed={Boolean(m.completed_at)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Activity */}
          <section aria-labelledby="project-activity">
            <h2 id="project-activity" className="section-heading mb-3">
              Activity
            </h2>
            {(activity ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No recorded activity yet.
              </p>
            ) : (
              <ol className="card divide-y divide-line">
                {((activity ?? []) as unknown as ActivityEvent[]).map((event) => (
                  <li key={event.id} className="px-4 py-2.5">
                    <p className="text-[13px]">
                      <span className="font-medium">
                        {event.actor?.full_name ?? "System"}
                      </span>{" "}
                      {event.summary}
                    </p>
                    <p className="meta">{relativeTime(event.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Activity gets its own full-width tab */}
        {tab === "activity" ? (
          <section aria-labelledby="project-activity-tab">
            <h2 id="project-activity-tab" className="section-heading mb-3">
              Activity
            </h2>
            {(activity ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No recorded activity yet.
              </p>
            ) : (
              <ol className="card divide-y divide-line">
                {((activity ?? []) as unknown as ActivityEvent[]).map((event) => (
                  <li key={event.id} className="px-4 py-2.5">
                    <p className="text-[13px]">
                      <span className="font-medium">
                        {event.actor?.full_name ?? "System"}
                      </span>{" "}
                      {event.summary}
                    </p>
                    <p className="meta">{relativeTime(event.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>

      {tab === "risks" ? (
          <RaidLogPanel
            log={raidLog}
            projectId={project.id}
            people={options.people}
            canManage={session.isStaff}
          />
        ) : null}

      <Suspense fallback={null}>
        <TaskDrawer people={options.people} isStaff={session.isStaff} />
      </Suspense>
    </div>
  );
}
