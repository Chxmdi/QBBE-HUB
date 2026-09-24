import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge, StageBadge } from "@/components/shared/status-badges";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomesPanel } from "@/features/outcomes/components/outcomes-panel";
import { ProgramEditDialog } from "@/features/programs/components/program-edit-dialog";
import { getProgramOutcomes } from "@/features/outcomes/services/outcome.queries";
import { summarizeProjectHealth } from "@/features/dashboard/health";
import { programAccent } from "@/features/programs/colors";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { hasProgramCapability } from "@/lib/access-capabilities";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils";
import type {
  ActivityEvent,
  EventRecord,
  Project,
  ProjectHealth,
} from "@/types/entities";

export const metadata: Metadata = { title: "Program" };
export const dynamic = "force-dynamic";

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const supabase = await createSupabasePageClient();
  const canManage = await hasProgramCapability(supabase, id, "manage");

  const { data: program } = await supabase
    .from("program")
    .select(
      "id, name, description, status, color, important_links, created_at, lead_id, lead:lead_id(id, full_name, avatar_url, title)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!program) notFound();

  const [{ data: projects }, { data: events }, { data: activity }, outcomes, options] =
    await Promise.all([
      supabase
        .from("project")
        .select(
          "id, name, outcome, stage, health, target_date, archived_at, owner:owner_id(id, full_name, avatar_url)",
        )
        .eq("program_id", id)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("event")
        .select("id, name, starts_at, status, location")
        .eq("program_id", id)
        .order("starts_at", { ascending: true })
        .limit(10),
      supabase
        .from("activity_event")
        .select(
          "id, actor_id, verb, source_type, source_id, summary, created_at, actor:actor_id(id, full_name, avatar_url)",
        )
        .eq("program_id", id)
        .order("created_at", { ascending: false })
        .limit(12),
      getProgramOutcomes(id),
      getPickerOptions(),
    ]);

  // The newest status update from any project in the programme. P0-PROG-02 asks
  // for "latest updates", and an activity feed is not that: it says a thing
  // happened, not how the work is going.
  const projectIds = (projects ?? []).map((project) => project.id as string);
  const { data: updates } = projectIds.length
    ? await supabase
        .from("project_status_update")
        .select(
          "id, project_id, health, progress_summary, created_at, author:author_id(id, full_name, avatar_url)",
        )
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(5)
    : { data: [] as unknown[] };

  // Who can reach this programme, and why. Read-only on purpose: granting
  // access is an administrator action (setDirectProgramAccess requires AAL2
  // admin), and a programme lead holds `manage`, not that. Showing the team
  // here without widening who may change it keeps the boundary where #24 put it.
  const { data: grants } = await supabase
    .from("program_access_grant")
    .select("user_id, role, source, member:user_id(id, full_name, avatar_url, title)")
    .eq("program_id", id)
    .order("role");

  const projectNameById = new Map(
    (projects ?? []).map((project) => [project.id as string, project.name as string]),
  );
  const rollUp = summarizeProjectHealth(
    (projects ?? []).map((project) => ({
      health: project.health as string,
      stage: project.stage as string,
      archived_at: (project.archived_at as string | null) ?? null,
    })),
  );
  const importantLinks = (program.important_links ?? []) as { label: string; url: string }[];

  const lead = program.lead as unknown as {
    full_name: string;
    avatar_url: string | null;
  } | null;

  return (
    <div>
      <div className="mb-2">
        <Link href="/programs" className="meta hover:text-brand-fg hover:underline">
          ← Programs
        </Link>
      </div>
      {/* Wayfinding only: the title beside it carries the meaning. */}
      <div
        aria-hidden="true"
        className="mb-4 h-1 w-16 rounded-full"
        style={{ background: programAccent(program.color) }}
      />
      <PageHeader
        eyebrow="Program"
        title={program.name}
        description={program.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-4">
          {canManage ? (
            <ProgramEditDialog program={program} people={options.people} />
          ) : null}
          <span className="flex items-center gap-2 text-[13.5px]">
            <HealthBadge health={rollUp.health} />
            <span className="meta">{rollUp.statusLabel}</span>
          </span>
          {lead ? (
            <span className="flex items-center gap-2 text-[13.5px]">
              <Avatar name={lead.full_name} src={lead.avatar_url} size="md" />
              <span>
                <span className="block font-medium">{lead.full_name}</span>
                <span className="meta">Program lead</span>
              </span>
            </span>
          ) : null}
          </div>
        }
      />

      {/* Outputs and outcomes come first: they are what the program is for,
          and what a funder asks about. */}
      <div className="mb-10">
        <OutcomesPanel
          outcomes={outcomes}
          programId={id}
          people={options.people}
          projects={(projects ?? []).map((p) => ({
            id: p.id as string,
            label: p.name as string,
          }))}
          canManage={canManage}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="program-updates" className="space-y-8">
          <div>
            <h2 id="program-updates" className="section-heading mb-3">
              Latest updates
            </h2>
            {(updates ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No project in this program has published a status update yet.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {((updates ?? []) as unknown as {
                  id: string;
                  project_id: string;
                  health: ProjectHealth;
                  progress_summary: string;
                  created_at: string;
                  author: { full_name: string } | null;
                }[]).map((update) => (
                  <li key={update.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/projects/${update.project_id}?tab=updates`}
                        className="text-[13.5px] font-medium hover:text-brand-fg"
                      >
                        {projectNameById.get(update.project_id) ?? "Project"}
                      </Link>
                      <HealthBadge health={update.health} />
                      <span className="meta ml-auto">
                        {relativeTime(update.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">
                      {update.progress_summary}
                    </p>
                    {update.author ? (
                      <p className="meta mt-0.5">{update.author.full_name}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {importantLinks.length > 0 ? (
            <div>
              <h2 className="section-heading mb-3">Important links</h2>
              <ul className="card divide-y divide-line">
                {importantLinks.map((link) => (
                  <li key={`${link.label}:${link.url}`} className="px-4 py-2.5">
                    {/* Stored links are external and not under QBBE's control. */}
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13.5px] font-medium hover:text-brand-fg hover:underline"
                    >
                      {link.label}
                    </a>
                    <p className="meta truncate">{link.url}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="program-projects">
          <h2 id="program-projects" className="section-heading mb-3">
            Projects
          </h2>
          {(projects ?? []).length === 0 ? (
            <EmptyState
              title="No projects in this program"
              description="Projects created under this program will appear here with health and ownership."
            />
          ) : (
            <ul className="card divide-y divide-line">
              {((projects ?? []) as unknown as Project[]).map((project) => (
                <li key={project.id} className="interactive-row flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-medium hover:text-brand-fg"
                    >
                      {project.name}
                    </Link>
                    {project.outcome ? (
                      <p className="meta truncate">{project.outcome}</p>
                    ) : null}
                  </div>
                  <span className="meta whitespace-nowrap">
                    {formatDate(project.target_date)}
                  </span>
                  <StageBadge stage={project.stage} />
                  <HealthBadge health={project.health} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-8">
          <section aria-labelledby="program-team">
            <h2 id="program-team" className="section-heading mb-3">
              Team
            </h2>
            {(grants ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                Nobody holds explicit access to this program yet.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {((grants ?? []) as unknown as {
                  user_id: string;
                  role: string;
                  source: string;
                  member: { full_name: string; avatar_url: string | null; title: string | null } | null;
                }[]).map((grant) => (
                  <li
                    key={`${grant.user_id}:${grant.role}:${grant.source}`}
                    className="flex items-center gap-2.5 px-4 py-2.5"
                  >
                    <Avatar
                      name={grant.member?.full_name ?? "Unknown"}
                      src={grant.member?.avatar_url ?? null}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">
                        {grant.member?.full_name ?? "Unknown member"}
                      </span>
                      <span className="meta">
                        {grant.role.replaceAll("_", " ")}
                        {grant.source === "direct" ? "" : ` · via ${grant.source.replaceAll("_", " ")}`}
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

          <section aria-labelledby="program-events">
            <h2 id="program-events" className="section-heading mb-3">
              Upcoming events
            </h2>
            {(events ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No events scheduled for this program.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {((events ?? []) as unknown as EventRecord[]).map((event) => (
                  <li key={event.id} className="px-4 py-2.5">
                    <Link
                      href={`/events/${event.id}`}
                      className="text-[13.5px] font-medium hover:text-brand-fg"
                    >
                      {event.name}
                    </Link>
                    <p className="meta">
                      {formatDateTime(event.starts_at)}
                      {event.location ? ` · ${event.location}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="program-activity">
            <h2 id="program-activity" className="section-heading mb-3">
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
      </div>
    </div>
  );
}
