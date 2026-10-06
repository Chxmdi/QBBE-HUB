import { instantToWallTime } from "@/lib/time";
import { CommentThread } from "@/features/comments/components/comment-thread";
import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { assignEventRole, updateEvent, updateEventStatus } from "@/features/events/services/event.commands";
import { addEventChecklistItem } from "@/features/events/services/event-checklist.commands";
import { EventChecklist } from "@/features/events/components/event-checklist";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("events.detailTitle") };
}
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
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  // Status and role codes are closed sets in the database; an unexpected one
  // shows as it is stored rather than as a raw key.
  const codeLabel = (group: "statusBadges" | "roles", code: string) => {
    const key = `events.${group}.${code}` as MessageKey;
    const label = t(key);
    return label === key ? code.replace(/_/g, " ") : label;
  };
  const statusLabel = (status: string) => codeLabel("statusBadges", status);
  const roleLabel = (role: string) => codeLabel("roles", role);
  const supabase = await createSupabasePageClient();

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
    ends_at: string | null;
    event_type: string | null;
    location: string | null;
    status: string;
    volunteer_need: number | null;
    owner: { full_name: string; avatar_url: string | null } | null;
    program: { id: string; name: string } | null;
    project: { id: string; name: string } | null;
  };

  const [{ data: assignments }, { data: checklist }, options] = await Promise.all([
    supabase
      .from("event_assignment")
      .select("id, event_id, user_id, role, user_profile:user_id(id, full_name, avatar_url)")
      .eq("event_id", id),
    supabase
      .from("event_checklist_item")
      .select("id, title, completed_at, sort_key")
      .eq("event_id", id)
      .order("sort_key", { ascending: true }),
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
      <Breadcrumbs
        items={[{ label: t("events.title"), href: "/events" }, { label: event.name }]}
      />
      <PageHeader
        eyebrow={format.dateTime(event.starts_at)}
        title={event.name}
        description={event.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={event.status === "completed" ? "success" : event.status === "cancelled" ? "neutral" : "info"}>
              {statusLabel(event.status)}
            </Badge>
            {/* The type was stored and shown only inside the edit dialog, so a
                value nobody could see without opening a form to change it. */}
            {event.event_type ? <Badge tone="neutral">{event.event_type}</Badge> : null}
            {session.isStaff && event.status !== "cancelled" ? (
              <>
                <EntityFormDialog
                  triggerLabel={t("events.detail.edit")}
                  triggerVariant="secondary"
                  title={t("events.detail.editTitle")}
                  submitLabel={t("events.detail.saveChanges")}
                  action={updateEvent}
                  extraValues={{ eventId: event.id }}
                  fields={[
                    { name: "name", label: t("events.fields.name"), type: "text", required: true, defaultValue: event.name },
                    { name: "description", label: t("events.fields.description"), type: "textarea", defaultValue: event.description ?? "" },
                    { name: "eventType", label: t("events.fields.eventType"), type: "text", defaultValue: event.event_type ?? "", colSpan: 1 },
                    { name: "volunteerNeed", label: t("events.fields.volunteersNeeded"), type: "number", defaultValue: event.volunteer_need ? String(event.volunteer_need) : "", colSpan: 1 },
                    { name: "startsAt", label: t("events.fields.starts"), type: "datetime-local", required: true, colSpan: 1, defaultValue: instantToWallTime(event.starts_at, session.timeZone) },
                    { name: "endsAt", label: t("events.fields.ends"), type: "datetime-local", required: true, colSpan: 1, defaultValue: instantToWallTime(event.ends_at ?? new Date(new Date(event.starts_at).getTime() + 60 * 60_000).toISOString(), session.timeZone) },
                    { name: "location", label: t("events.fields.location"), type: "text", defaultValue: event.location ?? "" },
                  ]}
                />
                <EntityFormDialog
                  triggerLabel={t("events.detail.updateStatus")}
                  triggerVariant="secondary"
                  title={t("events.detail.updateStatusTitle")}
                  submitLabel={t("events.detail.saveStatus")}
                  action={updateEventStatus}
                  extraValues={{ eventId: event.id }}
                  fields={[{
                    name: "status",
                    label: t("events.fields.status"),
                    type: "select",
                    required: true,
                    defaultValue: event.status,
                    options: (
                      ["planning", "confirmed", "in_progress", "completed", "cancelled"] as const
                    ).map((value) => ({ value, label: t(`events.statusOptions.${value}`) })),
                  }]}
                />
              </>
            ) : null}
          </div>
        }
      />

      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-(--radius-md) border border-line bg-surface px-4 py-3">
        {owner ? (
          <span className="flex items-center gap-2 text-[13.5px]">
            <Avatar name={owner.full_name} src={owner.avatar_url} size="sm" />
            <span>
              <span className="font-medium">{owner.full_name}</span>
              <span className="meta ml-1.5">{t("events.detail.owner")}</span>
            </span>
          </span>
        ) : null}
        {event.location ? (
          <span className="text-[13px] text-muted">{event.location}</span>
        ) : null}
        {event.volunteer_need ? (
          <span className="text-[13px] text-muted">
            {t(
              event.volunteer_need === 1
                ? "events.detail.volunteersNeededOne"
                : "events.detail.volunteersNeededOther",
              { count: event.volunteer_need },
            )}
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

      <section aria-labelledby="event-preparation" className="max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="event-preparation" className="section-heading">
            {t("events.detail.checklist")}
          </h2>
          {session.isStaff ? (
            <EntityFormDialog
              triggerLabel={t("events.detail.addItem")}
              triggerVariant="secondary"
              title={t("events.detail.addChecklistItem")}
              submitLabel={t("events.detail.add")}
              action={addEventChecklistItem}
              extraValues={{ eventId: event.id }}
              fields={[
                { name: "title", label: t("events.fields.whatNeedsDoing"), type: "text", required: true },
              ]}
            />
          ) : null}
        </div>
        <EventChecklist
          items={(checklist ?? []) as { id: string; title: string; completed_at: string | null }[]}
          canManage={session.isStaff}
        />
      </section>

      <section aria-labelledby="event-roles" className="max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="event-roles" className="section-heading">
            {t("events.detail.roleAssignments")}
          </h2>
          {session.isStaff ? (
            <EntityFormDialog
              triggerLabel={t("events.detail.assignRole")}
              triggerVariant="secondary"
              title={t("events.detail.assignRoleTitle")}
              submitLabel={t("events.detail.assign")}
              action={assignEventRole}
              extraValues={{ eventId: event.id }}
              fields={[
                {
                  name: "userId",
                  label: t("events.fields.person"),
                  type: "select",
                  required: true,
                  options: options.people.map((p) => ({ value: p.id, label: p.label })),
                },
                {
                  name: "role",
                  label: t("events.fields.responsibility"),
                  type: "select",
                  required: true,
                  options: EVENT_ROLES.map((role) => ({
                    value: role,
                    label: t(`events.roles.${role}`),
                  })),
                },
              ]}
            />
          ) : null}
        </div>
        {assignmentList.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            {t("events.detail.rolesEmpty")}
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
                  {assignment.user_profile?.full_name ?? t("events.detail.unknown")}
                </span>
                <Badge tone="brand">{roleLabel(assignment.role)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      <CommentThread parentType="event" parentId={id} />
    </div>
  );
}
