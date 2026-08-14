import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { assignEventRole } from "@/features/events/services/event.commands";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Event" };
export const dynamic = "force-dynamic";

const EVENT_ROLES = [
  "logistics", "communications", "volunteers", "venue",
  "content", "registration", "follow_up",
] as const;

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: eventRow } = await supabase
    .from("event")
    .select(
      "id, program_id, project_id, name, description, owner_id, event_type, starts_at, ends_at, location, status, volunteer_need, channel_id, " +
        "owner:owner_id(id, full_name, avatar_url), program:program_id(id, name), project:project_id(id, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!eventRow) notFound();
  const event = eventRow as unknown as {
    id: string;
    name: string;
    description: string | null;
    starts_at: string;
    location: string | null;
    status: string;
    volunteer_need: number | null;
    owner: { full_name: string; avatar_url: string | null } | null;
    program: { id: string; name: string } | null;
    project: { id: string; name: string } | null;
  };

  const [{ data: assignments }, options] = await Promise.all([
    supabase
      .from("event_assignment")
      .select("id, event_id, user_id, role, user_profile:user_id(id, full_name, avatar_url)")
      .eq("event_id", id),
    getPickerOptions(),
  ]);

  type AssignmentRow = {
    id: string;
    role: string;
    user_profile: { id: string; full_name: string; avatar_url: string | null } | null;
  };
  const assignmentList = (assignments ?? []) as unknown as AssignmentRow[];
  const owner = event.owner;
  const program = event.program;
  const project = event.project;

  return (
    <div>
      <div className="mb-2">
        <Link href="/events" className="meta hover:text-brand-fg hover:underline">
          ← Events
        </Link>
      </div>
      <PageHeader
        eyebrow={formatDateTime(event.starts_at)}
        title={event.name}
        description={event.description ?? undefined}
        actions={
          <Badge tone={event.status === "completed" ? "success" : "info"}>
            {(event.status as string).replace(/_/g, " ")}
          </Badge>
        }
      />

      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-(--radius-md) border border-line bg-surface px-4 py-3">
        {owner ? (
          <span className="flex items-center gap-2 text-[13.5px]">
            <Avatar name={owner.full_name} src={owner.avatar_url} size="sm" />
            <span>
              <span className="font-medium">{owner.full_name}</span>
              <span className="meta ml-1.5">Event owner</span>
            </span>
          </span>
        ) : null}
        {event.location ? (
          <span className="text-[13px] text-muted">{event.location}</span>
        ) : null}
        {event.volunteer_need ? (
          <span className="text-[13px] text-muted">
            {event.volunteer_need} volunteers needed
          </span>
        ) : null}
        {program ? (
          <Link
            href={`/programs/${program.id}`}
            className="text-[13px] font-medium text-brand-fg hover:underline"
          >
            {program.name} →
          </Link>
        ) : null}
        {project ? (
          <Link
            href={`/projects/${project.id}`}
            className="text-[13px] font-medium text-brand-fg hover:underline"
          >
            {project.name} →
          </Link>
        ) : null}
      </div>

      <section aria-labelledby="event-roles" className="max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="event-roles" className="section-heading">
            Role assignments
          </h2>
          {session.isStaff ? (
            <EntityFormDialog
              triggerLabel="Assign role"
              triggerVariant="secondary"
              title="Assign event role"
              submitLabel="Assign"
              action={assignEventRole}
              extraValues={{ eventId: event.id }}
              fields={[
                {
                  name: "userId",
                  label: "Person",
                  type: "select",
                  required: true,
                  options: options.people.map((p) => ({ value: p.id, label: p.label })),
                },
                {
                  name: "role",
                  label: "Responsibility",
                  type: "select",
                  required: true,
                  options: EVENT_ROLES.map((role) => ({
                    value: role,
                    label: role.replace(/_/g, " "),
                  })),
                },
              ]}
            />
          ) : null}
        </div>
        {assignmentList.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            Assign distinct owners for logistics, communications, volunteers,
            venue, content, registration, and follow-up.
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {assignmentList.map((assignment) => (
              <li key={assignment.id} className="flex items-center gap-3 px-4 py-2.5">
                {assignment.user_profile ? (
                  <Avatar
                    name={assignment.user_profile.full_name}
                    src={assignment.user_profile.avatar_url}
                    size="sm"
                  />
                ) : null}
                <span className="flex-1 text-[13.5px] font-medium">
                  {assignment.user_profile?.full_name ?? "Unknown"}
                </span>
                <Badge tone="brand">{assignment.role.replace(/_/g, " ")}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
