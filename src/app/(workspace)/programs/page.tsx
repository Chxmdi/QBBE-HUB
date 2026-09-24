import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge } from "@/components/shared/status-badges";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgramCreateDialog } from "@/features/programs/components/program-create-dialog";
import { CreateProgramFromTemplateButton } from "@/features/programs/components/create-program-from-template";
import {
  createProgramTemplate,
  listApprovedProgramTemplates,
  listProgramTemplatesForAdmin,
} from "@/features/programs/services/program-template.commands";
import { ProgramTemplateManager } from "@/features/programs/components/program-template-manager";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { summarizeProjectHealth } from "@/features/dashboard/health";
import { programAccent } from "@/features/programs/colors";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import type { Project } from "@/types/entities";

export const metadata: Metadata = { title: "Programs" };
export const dynamic = "force-dynamic";

interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string | null;
  lead: { id: string; full_name: string; avatar_url: string | null } | null;
}

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; status?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const archived = params.status === "archived";
  const supabase = await createSupabasePageClient();

  const [{ data: programs }, { data: projects }, options] = await Promise.all([
    supabase
      .from("program")
      .select("id, name, description, status, color, lead:lead_id(id, full_name, avatar_url)")
      .filter("status", archived ? "eq" : "neq", "archived")
      .order("name"),
    supabase
      .from("project")
      .select("id, name, program_id, stage, health, archived_at")
      .is("archived_at", null),
    getPickerOptions(),
  ]);

  const programTemplates = await listApprovedProgramTemplates();
  // Administrators maintain the structures; everyone else only sees the
  // approved ones they can build from.
  const [adminTemplates, { data: projectTemplates }] = session.isAdmin
    ? await Promise.all([
        listProgramTemplatesForAdmin(),
        supabase.from("project_template").select("id, name").order("name"),
      ])
    : [[], { data: [] as { id: string; name: string }[] }];

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
          <div className="flex flex-wrap items-center gap-2">
            <CreateProgramFromTemplateButton templates={programTemplates} />
            {session.isAdmin ? (
              <EntityFormDialog
                triggerLabel="Save template"
                triggerVariant="secondary"
                title="Program template"
                submitLabel="Save"
                action={createProgramTemplate}
                fields={[
                  { name: "name", label: "Name", type: "text", required: true },
                  { name: "description", label: "Description", type: "textarea" },
                ]}
              />
            ) : null}
            <ProgramCreateDialog people={options.people} defaultOpen={params.create === "1"} />
          </div>
        }
      />

      <nav aria-label="Program archive" className="mb-6 flex gap-4 text-sm">
        <Link href="/programs" aria-current={!archived ? "page" : undefined} className="hover:underline">Current programs</Link>
        <Link href="/programs?status=archived" aria-current={archived ? "page" : undefined} className="hover:underline">Archived programs</Link>
      </nav>
      {programList.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title={archived ? "No archived programs" : "No programs yet"}
          description={archived ? "Archived programs will appear here for review and restoration." : "Create a program to group related projects, events, and channels."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {programList.map((program) => {
            const programProjects = projectList.filter(
              (p) => p.program_id === program.id,
            );
            const active = programProjects.filter((p) => p.stage === "active");
            const { health: worstHealth } = summarizeProjectHealth(programProjects);
            return (
              <Link
                key={program.id}
                href={`/programs/${program.id}`}
                className="card group relative flex flex-col gap-3 overflow-hidden p-5 transition-colors hover:border-brand/40"
              >
                {/* Wayfinding only: the name and the health badge carry the
                    meaning, so this is hidden from assistive technology. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: programAccent(program.color) }}
                />
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

      {session.isAdmin ? (
        <section aria-labelledby="program-templates" className="mt-10">
          <h2 id="program-templates" className="section-heading mb-3">
            Program templates
          </h2>
          <p className="mb-3 text-[13px] text-muted">
            An approved template can be used to create a program with its
            projects, milestones and standard tasks already in place. Templates
            carry structure only — no comments, notes or history are copied.
          </p>
          <ProgramTemplateManager
            templates={adminTemplates}
            projectTemplates={(projectTemplates ?? []) as { id: string; name: string }[]}
          />
        </section>
      ) : null}
    </div>
  );
}
