import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge } from "@/components/shared/status-badges";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgramCreateDialog } from "@/features/programs/components/program-create-dialog";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Project, ProjectHealth } from "@/types/entities";

export const metadata: Metadata = { title: "Programs" };
export const dynamic = "force-dynamic";

interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  lead: { id: string; full_name: string; avatar_url: string | null } | null;
}

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: programs }, { data: projects }, options] = await Promise.all([
    supabase
      .from("program")
      .select("id, name, description, status, lead:lead_id(id, full_name, avatar_url)")
      .neq("status", "archived")
      .order("name"),
    supabase
      .from("project")
      .select("id, name, program_id, stage, health")
      .is("archived_at", null),
    getPickerOptions(),
  ]);

  const programList = (programs ?? []) as unknown as ProgramRow[];
  const projectList = (projects ?? []) as unknown as (Project & {
    program_id: string | null;
  })[];

  return (
    <div>
      <PageHeader
        eyebrow="Long-running services"
        title="Programs"
        description="Programs organize QBBE's ongoing services; projects deliver their time-bound outcomes."
        actions={
          <ProgramCreateDialog people={options.people} defaultOpen={params.create === "1"} />
        }
      />

      {programList.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No programs yet"
          description="Create a program to group related projects, events, and channels."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {programList.map((program) => {
            const programProjects = projectList.filter(
              (p) => p.program_id === program.id,
            );
            const active = programProjects.filter((p) => p.stage === "active");
            const worstHealth: ProjectHealth = active.some(
              (p) => p.health === "off_track",
            )
              ? "off_track"
              : active.some((p) => p.health === "at_risk")
                ? "at_risk"
                : active.length > 0
                  ? "on_track"
                  : "unknown";
            return (
              <Link
                key={program.id}
                href={`/programs/${program.id}`}
                className="card group flex flex-col gap-3 p-5 transition-colors hover:border-brand/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[16px] font-semibold group-hover:text-brand-fg">
                    {program.name}
                  </h2>
                  <HealthBadge health={worstHealth} />
                </div>
                {program.description ? (
                  <p className="line-clamp-2 text-[13.5px] text-muted">
                    {program.description}
                  </p>
                ) : null}
                <div className="mt-auto flex items-center gap-3 pt-1">
                  {program.lead ? (
                    <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                      <Avatar
                        name={program.lead.full_name}
                        src={program.lead.avatar_url}
                        size="xs"
                      />
                      {program.lead.full_name}
                    </span>
                  ) : null}
                  <span className="meta ml-auto">
                    {active.length} active · {programProjects.length} total projects
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
