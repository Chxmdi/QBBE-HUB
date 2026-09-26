import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DeepLinkScroll } from "@/components/shared/deep-link-scroll";
import { LinkTabs } from "@/components/shared/link-tabs";
import { HealthBadge } from "@/components/shared/status-badges";
import { CloseProjectDialog } from "@/features/projects/components/close-project-dialog";
import { ProjectEditDialog } from "@/features/projects/components/project-edit-dialog";
import { MilestoneRail } from "@/features/projects/components/milestone-rail";
import { compareMilestones } from "@/features/projects/schemas";
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
import { requireSession } from "@/lib/auth";
import { hasProjectCapability } from "@/lib/access-capabilities";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { formatDate, relativeTime } from "@/lib/utils";
import { RecordComments } from "@/features/comments/components/record-comments";
import { DecisionLog } from "@/features/risks/components/decision-log";
import { RaidLogPanel } from "@/features/risks/components/raid-log";
import { getProjectDecisions } from "@/features/risks/services/decision.queries";
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
  searchParams: Promise<{ tab?: string; risk?: string; issue?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { tab: tabParam, risk: riskParam, issue: issueParam } = await searchParams;
  const highlightRiskId = riskParam ?? null;
  const highlightIssueId = issueParam ?? null;
  // A search result carries ?tab=risks with it, but a link that has lost the
  // tab still knows which record it means — honour it rather than opening the
  // overview and looking broken.
  const tab =
    tabParam ?? (highlightRiskId || highlightIssueId ? "risks" : "overview");
  const supabase = await createSupabasePageClient();

  const { data: projectRow } = await supabase
    .from("project")
    .select(
      "id, program_id, name, outcome, description, stage, health, health_reason, start_date, target_date, created_at, archived_at, owner_id, " +
        "sponsor_id, priority, reporting_cadence, funding_source_id, " +
        "owner:owner_id(id, full_name, email, avatar_url, title, timezone), " +
        "sponsor:sponsor_id(id, full_name, avatar_url), program:program_id(id, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!projectRow) notFound();
  const project = projectRow as unknown as Project;
  const [canManage, canCollaborate] = await Promise.all([
    hasProjectCapability(supabase, id, "manage"),
    hasProjectCapability(supabase, id, "collaborate"),
  ]);


  const [
    { data: milestones },
    { data: tasks },
    { data: updates },
    { data: activity },
    options,
    raidLog,
    decisionLog,
    { data: comments },
    { data: grants },
    { data: documents },
    { data: meetings },
    { data: channel },
    { data: closure },
    { data: milestoneDependencies },
    { data: funders },
  ] = await Promise.all([
    supabase
      .from("milestone")
      .select(
        "id, project_id, name, description, status, evidence, owner_id, " +
          "due_date, completed_at, sort_key, " +
          "owner:owner_id(id, full_name, email, avatar_url, title, timezone)",
      )
      .eq("project_id", id)
      // Ordered in TypeScript by compareMilestones, so the rail, the reorder
      // buttons and the progress count all read one order rather than three.
      .order("sort_key", { ascending: true }),
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
    getRaidLog(id, session.timeZone),
    getProjectDecisions(id),
    supabase
      .from("record_comment")
      .select("id, body, author_id, created_at, resolved_at, deleted_at")
      .eq("parent_type", "project")
      .eq("parent_id", id)
      .order("created_at", { ascending: true })
      .limit(50),
    // P0-PRJ-03 names team, files, meetings and the project channel. All four
    // are stored against the project and none of them was read on this page.
    supabase
      .from("project_access_grant")
      .select("user_id, role, source, member:user_id(id, full_name, avatar_url, title)")
      .eq("project_id", id)
      .order("role"),
    supabase
      .from("document")
      .select("id, title, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("meeting")
      .select("id, title, starts_at, status")
      .eq("project_id", id)
      .order("starts_at", { ascending: false })
      .limit(5),
    supabase
      .from("channel")
      .select("id, name, slug")
      .eq("project_id", id)
      .maybeSingle(),
    // How it ended, and the evidence for it (P1-PRJ-08). Null until closed.
    supabase
      .from("project_closure")
      .select(
        "id, results, lessons, evidence_links, closed_at, " +
          "closer:closed_by(id, full_name), " +
          "evidence:project_closure_document(document:document_id(id, title))",
      )
      .eq("project_id", id)
      .maybeSingle(),
    // Dependency edges (P1-TSK-09). RLS already limits these to edges whose
    // both ends this viewer may read; they are narrowed to this project's
    // milestones below, once that list exists.
    supabase
      .from("milestone_dependency")
      .select("blocking_milestone_id, blocked_milestone_id"),
    supabase
      .from("crm_organization")
      .select("id, name")
      .in("category", ["funder", "sponsor", "donor", "government"])
      .eq("status", "active")
      .order("name"),
  ]);

  type TeamGrant = {
    user_id: string;
    role: string;
    source: string;
    member: { full_name: string; avatar_url: string | null; title: string | null } | null;
  };
  const teamGrants = (grants ?? []) as unknown as TeamGrant[];
  const projectDocuments = (documents ?? []) as unknown as {
    id: string;
    title: string;
    created_at: string;
  }[];
  const projectMeetings = (meetings ?? []) as unknown as {
    id: string;
    title: string;
    starts_at: string;
    status: string;
  }[];
  const projectChannel = channel as unknown as { id: string; name: string; slug: string } | null;
  const projectClosure = closure as unknown as {
    id: string;
    results: string;
    lessons: string | null;
    evidence_links: { label: string; url: string }[];
    closed_at: string;
    closer: { id: string; full_name: string } | null;
    evidence: { document: { id: string; title: string } | null }[];
  } | null;

  const milestoneList = ((milestones ?? []) as unknown as Milestone[]).sort(
    compareMilestones,
  );
  const completedMilestones = milestoneList.filter((m) => m.completed_at).length;

  // Keep only the edges that join two milestones on this page. An edge whose
  // other end lives in a different project is readable and real, but the rail
  // has no name to show for it, and a row reading "blocked by a milestone
  // elsewhere" tells somebody less than nothing.
  const milestoneIdSet = new Set(milestoneList.map((m) => m.id));
  const projectMilestoneDependencies = (milestoneDependencies ?? []).filter(
    (edge) =>
      milestoneIdSet.has(edge.blocking_milestone_id) &&
      milestoneIdSet.has(edge.blocked_milestone_id),
  );
  // "Progress signals" in P0-PRJ-03 was only an open-task count on a tab badge.
  // Milestone burn is the signal a reader actually asks for.
  const nextMilestone = milestoneList
    .filter((m) => !m.completed_at && m.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];

  const taskList = (tasks ?? []) as unknown as Task[];
  const openTasks = taskList.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled",
  );
  const doneTasks = taskList.filter((t) => t.status === "completed");

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          ...(project.program
            ? [{ label: project.program.name, href: `/programs/${project.program.id}` }]
            : []),
          { label: project.name },
        ]}
      />
      <PageHeader
        eyebrow={project.program?.name ?? "Independent project"}
        title={project.name}
        description={project.outcome ?? undefined}
        actions={
          canManage || canCollaborate ? (
            <>
              {canManage ? (
                <>
                  <ProjectEditDialog
                    project={project as unknown as Parameters<typeof ProjectEditDialog>[0]["project"]}
                    programs={options.programs}
                    people={options.people}
                    funders={((funders ?? []) as { id: string; name: string }[]).map((funder) => ({
                      id: funder.id,
                      label: funder.name,
                    }))}
                  />
                  <StageSelect projectId={project.id} stage={project.stage} />
                  {project.stage !== "completed" && project.stage !== "archived" ? (
                    <CloseProjectDialog
                      projectId={project.id}
                      projectName={project.name}
                      documents={projectDocuments}
                    />
                  ) : null}
                </>
              ) : null}
              <TaskCreateDialog
                projects={[{ id: project.id, label: project.name }]}
                people={options.people}
                milestones={options.milestones}
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
          <span className="meta">Progress</span>
          <span className="text-[13.5px] font-medium">
            {milestoneList.length > 0
              ? `${completedMilestones}/${milestoneList.length} milestones`
              : "No milestones"}
            {openTasks.length > 0 ? ` · ${openTasks.length} open tasks` : ""}
          </span>
        </div>
        {nextMilestone ? (
          <div className="flex items-center gap-2">
            <span className="meta">Next milestone</span>
            <span className="text-[13.5px] font-medium">
              {nextMilestone.name} · {formatDate(nextMilestone.due_date)}
            </span>
          </div>
        ) : null}
        {projectChannel ? (
          <div className="flex items-center gap-2">
            <span className="meta">Channel</span>
            <Link
              href={`/channels/${projectChannel.id}`}
              className="text-[13.5px] font-medium hover:text-brand-fg hover:underline"
            >
              #{projectChannel.slug}
            </Link>
          </div>
        ) : null}
        {/* P0-PRJ-02 names a sponsor beside the accountable owner. It is a
            column on project, not one of the scoped roles. */}
        <div className="flex items-center gap-2">
          <span className="meta">Sponsor</span>
          {project.sponsor ? (
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
              <Avatar
                name={project.sponsor.full_name}
                src={project.sponsor.avatar_url}
                size="sm"
              />
              {project.sponsor.full_name}
            </span>
          ) : (
            <span className="text-[13.5px] text-muted">Not named</span>
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
            id: "team",
            label: "Team",
            href: `/projects/${project.id}?tab=team`,
            count: teamGrants.length,
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
          {/* How it ended. Shown first on a closed project, because on a closed
              project it is the answer to the question the reader came with. */}
          {projectClosure ? (
            <section
              aria-labelledby="project-closure"
              className={tab === "overview" || tab === "updates" ? "" : "hidden"}
            >
              <h2 id="project-closure" className="section-heading mb-3">
                How it ended
              </h2>
              <div className="card space-y-3 p-4">
                <p className="meta">
                  Closed {formatDate(projectClosure.closed_at)}
                  {projectClosure.closer
                    ? ` by ${projectClosure.closer.full_name}`
                    : ""}
                </p>
                <div>
                  <h3 className="text-[13px] font-medium text-muted">
                    What it delivered
                  </h3>
                  <p className="mt-0.5 whitespace-pre-line text-[13.5px]">
                    {projectClosure.results}
                  </p>
                </div>
                {projectClosure.lessons ? (
                  <div>
                    <h3 className="text-[13px] font-medium text-muted">
                      Lessons learned
                    </h3>
                    <p className="mt-0.5 whitespace-pre-line text-[13.5px]">
                      {projectClosure.lessons}
                    </p>
                  </div>
                ) : null}
                {projectClosure.evidence_links.length > 0 ||
                projectClosure.evidence.length > 0 ? (
                  <div>
                    <h3 className="text-[13px] font-medium text-muted">Evidence</h3>
                    <ul className="mt-0.5 space-y-0.5 text-[13.5px]">
                      {projectClosure.evidence_links.map((link) => (
                        <li key={link.url}>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-brand-fg hover:underline"
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                      {projectClosure.evidence
                        .map((row) => row.document)
                        .filter((document) => document !== null)
                        .map((document) => (
                          <li key={document.id}>
                            <Link
                              href={`/documents?document=${document.id}`}
                              className="font-medium text-brand-fg hover:underline"
                            >
                              {document.title}
                            </Link>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

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
                  <TaskRow key={task.id} task={task} timeZone={session.timeZone} />
                ))}
                {doneTasks.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer border-t border-line bg-surface-soft/60 px-3 py-2 text-[12.5px] font-medium text-muted">
                      Completed ({doneTasks.length})
                    </summary>
                    {doneTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        timeZone={session.timeZone}
                        showStatusControl={false}
                      />
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
            {canManage ? (
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
                    {update.help_requested ? (
                      <p className="mt-1 text-[13px]">
                        <span className="font-medium">Help requested:</span>{" "}
                        {update.help_requested}
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
              {canManage ? (
                <EntityFormDialog
                  triggerLabel="Add milestone"
                  triggerVariant="secondary"
                  title="Add milestone"
                  submitLabel="Create"
                  extraValues={{ projectId: project.id }}
                  action={createMilestone}
                  fields={[
                    { name: "name", label: "Name", type: "text", required: true },
                    { name: "description", label: "Description", type: "textarea" },
                    {
                      name: "ownerId",
                      label: "Owner",
                      type: "select",
                      colSpan: 1,
                      options: options.people.map((p) => ({
                        value: p.id,
                        label: p.label,
                      })),
                    },
                    { name: "dueDate", label: "Target date", type: "date", colSpan: 1 },
                  ]}
                />
              ) : null}
            </div>
            <MilestoneRail
              milestones={milestoneList}
              people={options.people}
              canManage={canManage}
              dependencies={projectMilestoneDependencies}
            />
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

        {tab === "overview" ? (
          <section aria-labelledby="project-links" className="space-y-8">
            <div>
              <h2 id="project-links" className="section-heading mb-3">
                Files
              </h2>
              {projectDocuments.length === 0 ? (
                <p className="card px-4 py-6 text-center text-[13px] text-muted">
                  No files linked to this project.
                </p>
              ) : (
                <ul className="card divide-y divide-line">
                  {projectDocuments.map((document) => (
                    <li key={document.id} className="px-4 py-2.5">
                      <Link
                        href={`/documents?document=${document.id}`}
                        className="text-[13.5px] font-medium hover:text-brand-fg"
                      >
                        {document.title}
                      </Link>
                      <p className="meta">{relativeTime(document.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h2 className="section-heading mb-3">Meetings</h2>
              {projectMeetings.length === 0 ? (
                <p className="card px-4 py-6 text-center text-[13px] text-muted">
                  No meetings linked to this project.
                </p>
              ) : (
                <ul className="card divide-y divide-line">
                  {projectMeetings.map((meeting) => (
                    <li key={meeting.id} className="px-4 py-2.5">
                      <Link
                        href={`/meetings/${meeting.id}`}
                        className="text-[13.5px] font-medium hover:text-brand-fg"
                      >
                        {meeting.title}
                      </Link>
                      <p className="meta">{formatDate(meeting.starts_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {/* P0-PRJ-02/03: who is on this project, and how they got here. Like the
            program team panel this is read-only — granting project access is an
            AAL2 administrator action, and a project manager holds `manage`. */}
        {tab === "team" ? (
          <section aria-labelledby="project-team-tab">
            <h2 id="project-team-tab" className="section-heading mb-3">
              Team
            </h2>
            {teamGrants.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                Nobody holds explicit access to this project yet. The owner
                manages it through ownership.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {teamGrants.map((grant) => (
                  <li
                    key={`${grant.user_id}:${grant.role}:${grant.source}`}
                    className="flex items-center gap-2.5 px-4 py-2.5"
                  >
                    <Avatar
                      name={grant.member?.full_name ?? "Unknown"}
                      src={grant.member?.avatar_url ?? null}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">
                        {grant.member?.full_name ?? "Unknown member"}
                      </span>
                      <span className="meta">
                        {grant.role.replaceAll("_", " ")}
                        {grant.source === "direct"
                          ? ""
                          : ` · via ${grant.source.replaceAll("_", " ")}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canManage ? (
              <p className="meta mt-2">
                Access is granted by an administrator in{" "}
                <Link href="/admin/access" className="hover:underline">
                  access administration
                </Link>
                .
              </p>
            ) : null}
          </section>
        ) : null}

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
        <>
          <RaidLogPanel
            log={raidLog}
            projectId={project.id}
            people={options.people}
            canManage={canManage}
            highlightRiskId={highlightRiskId}
            highlightIssueId={highlightIssueId}
          />
          <DecisionLog
            projectId={project.id}
            decisions={decisionLog.decisions}
            requests={decisionLog.requests}
            people={options.people}
            canManage={canManage}
          />
          <DeepLinkScroll
            targetId={
              highlightRiskId
                ? `risk-${highlightRiskId}`
                : highlightIssueId
                  ? `issue-${highlightIssueId}`
                  : null
            }
          />
        </>
      ) : null}

      <RecordComments
        parentType="project"
        parentId={project.id}
        comments={(comments ?? []) as {
          id: string;
          body: string;
          author_id: string;
          created_at: string;
          resolved_at: string | null;
          deleted_at: string | null;
        }[]}
      />
      <Suspense fallback={null}>
        <TaskDrawer people={options.people} isStaff={canCollaborate || canManage} />
      </Suspense>
    </div>
  );
}
