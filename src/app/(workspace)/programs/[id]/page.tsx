import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge, StageBadge } from "@/components/shared/status-badges";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils";
import type { ActivityEvent, EventRecord, Project } from "@/types/entities";

export const metadata: Metadata = { title: "Program" };
export const dynamic = "force-dynamic";

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: program } = await supabase
    .from("program")
    .select(
      "id, name, description, status, created_at, lead:lead_id(id, full_name, avatar_url, title)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!program) notFound();

  const [{ data: projects }, { data: events }, { data: activity }] =
    await Promise.all([
      supabase
        .from("project")
        .select(
          "id, name, outcome, stage, health, target_date, owner:owner_id(id, full_name, avatar_url)",
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
    ]);

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
      <PageHeader
        eyebrow="Program"
        title={program.name}
        description={program.description ?? undefined}
        actions={
          lead ? (
            <span className="flex items-center gap-2 text-[13.5px]">
              <Avatar name={lead.full_name} src={lead.avatar_url} size="md" />
              <span>
                <span className="block font-medium">{lead.full_name}</span>
                <span className="meta">Program lead</span>
              </span>
            </span>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
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
