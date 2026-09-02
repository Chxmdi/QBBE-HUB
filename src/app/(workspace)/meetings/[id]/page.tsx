import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ExternalLink, Gavel, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AttendeeList } from "@/features/meetings/components/attendee-list";
import { CancelMeetingButton } from "@/features/meetings/components/cancel-meeting-button";
import { CompleteMeetingButton } from "@/features/meetings/components/complete-meeting-button";
import { MeetingNotesForm } from "@/features/meetings/components/meeting-notes-form";
import {
  addAgendaItem,
  addMeetingAction,
  recordDecision,
  updateMeeting,
} from "@/features/meetings/services/meeting.commands";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { AgendaItem, Decision, MeetingAction } from "@/types/entities";

export const metadata: Metadata = { title: "Meeting" };
export const dynamic = "force-dynamic";

const KIND_TONES = {
  information: "info",
  discussion: "neutral",
  decision: "brand",
} as const;

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: meetingRow } = await supabase
    .from("meeting")
    .select(
      "id, title, purpose, organizer_id, starts_at, ends_at, location, meeting_link, status, notes, channel_id, project_id, summary_posted_at, " +
        "organizer:organizer_id(id, full_name, avatar_url), project:project_id(id, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!meetingRow) notFound();
  const meeting = meetingRow as unknown as {
    id: string;
    title: string;
    organizer_id: string;
    purpose: string | null;
    starts_at: string;
    ends_at: string | null;
    location: string | null;
    meeting_link: string | null;
    status: string;
    notes: string | null;
    project_id: string | null;
    summary_posted_at: string | null;
    organizer: { full_name: string; avatar_url: string | null } | null;
    project: { id: string; name: string } | null;
  };

  const [{ data: agenda }, { data: actions }, { data: decisions }, options, { data: attendeeRows }] =
    await Promise.all([
      supabase
        .from("agenda_item")
        .select(
          "id, meeting_id, title, kind, owner_id, desired_outcome, time_box_minutes, sort_key, status, owner:owner_id(id, full_name, avatar_url)",
        )
        .eq("meeting_id", id)
        .order("sort_key"),
      supabase
        .from("meeting_action")
        .select(
          "id, meeting_id, task_id, title, owner_id, due_at, owner:owner_id(id, full_name, avatar_url)",
        )
        .eq("meeting_id", id)
        .order("created_at"),
      supabase
        .from("decision")
        .select("id, project_id, meeting_id, title, detail, decided_at, decided_by")
        .eq("meeting_id", id)
        .order("decided_at"),
      getPickerOptions(),
      supabase
        .from("meeting_attendee")
        .select("user_id, user:user_id(id, full_name, avatar_url)")
        .eq("meeting_id", id),
    ]);

  type AttendeeRow = {
    user_id: string;
    user: { id: string; full_name: string; avatar_url: string | null } | null;
  };
  const attendees = ((attendeeRows ?? []) as unknown as AttendeeRow[])
    .map((row) => ({
      userId: row.user_id,
      name: row.user?.full_name ?? "Unknown person",
      avatarUrl: row.user?.avatar_url ?? null,
      isOrganizer: row.user_id === meeting.organizer_id,
    }))
    // Organizer first, then alphabetical — a list people scan for a name.
    .sort((a, b) =>
      a.isOrganizer === b.isOrganizer
        ? a.name.localeCompare(b.name)
        : a.isOrganizer
          ? -1
          : 1,
    );

  const organizer = meeting.organizer;
  const project = meeting.project;
  const isCompleted = meeting.status === "completed";
  const isCancelled = meeting.status === "cancelled";
  const isActive = !isCompleted && !isCancelled;

  return (
    <div>
      <div className="mb-2">
        <Link href="/meetings" className="meta hover:text-brand-fg hover:underline">
          ← Meetings
        </Link>
      </div>
      <PageHeader
        eyebrow={formatDateTime(meeting.starts_at)}
        title={meeting.title}
        description={meeting.purpose ?? undefined}
        actions={
          session.isStaff && isActive ? (
            <div className="flex flex-wrap items-start gap-2">
              <EntityFormDialog
                triggerLabel="Edit"
                triggerVariant="secondary"
                title="Edit meeting"
                submitLabel="Save changes"
                action={updateMeeting}
                extraValues={{ meetingId: meeting.id }}
                fields={[
                  { name: "title", label: "Title", type: "text", required: true, defaultValue: meeting.title },
                  { name: "purpose", label: "Purpose", type: "textarea", defaultValue: meeting.purpose ?? "" },
                  { name: "startsAt", label: "Starts", type: "datetime-local", required: true, colSpan: 1, defaultValue: new Date(meeting.starts_at).toISOString().slice(0, 16) },
                  { name: "durationMinutes", label: "Duration (minutes)", type: "number", required: true, colSpan: 1, defaultValue: String(Math.max(15, Math.round(((meeting.ends_at ? new Date(meeting.ends_at).getTime() : new Date(meeting.starts_at).getTime() + 3_600_000) - new Date(meeting.starts_at).getTime()) / 60_000))) },
                  { name: "location", label: "Location", type: "text", defaultValue: meeting.location ?? "" },
                ]}
              />
              <CancelMeetingButton meetingId={meeting.id} />
              <CompleteMeetingButton meetingId={meeting.id} />
            </div>
          ) : isCompleted ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3" aria-hidden />
              Completed{meeting.summary_posted_at ? " · summary posted" : ""}
            </Badge>
          ) : isCancelled ? (
            <Badge tone="danger">Cancelled</Badge>
          ) : undefined
        }
      />

      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-(--radius-md) border border-line bg-surface px-4 py-3">
        {organizer ? (
          <span className="flex items-center gap-2 text-[13.5px]">
            <Avatar name={organizer.full_name} src={organizer.avatar_url} size="sm" />
            <span>
              <span className="font-medium">{organizer.full_name}</span>
              <span className="meta ml-1.5">Organizer</span>
            </span>
          </span>
        ) : null}
        {project ? (
          <Link
            href={`/projects/${project.id}`}
            className="text-[13px] font-medium text-brand-fg hover:underline"
          >
            {project.name} →
          </Link>
        ) : null}
        {meeting.location ? (
          <span className="text-[13px] text-muted">{meeting.location}</span>
        ) : null}
        {meeting.meeting_link ? (
          <a
            href={meeting.meeting_link}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
          >
            Join meeting <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          {/* Agenda builder (P0-AGD-01/02) */}
          <section aria-labelledby="attendees-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="attendees-heading" className="section-heading">
                Attendees
              </h2>
            </div>
            <AttendeeList
              meetingId={meeting.id}
              attendees={attendees}
              people={options.people.map((p) => ({ id: p.id, label: p.label }))}
              canManage={session.isStaff && isActive}
            />
          </section>

          <section aria-labelledby="agenda-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="agenda-heading" className="section-heading">
                Agenda
              </h2>
              {isActive ? (
                <EntityFormDialog
                  triggerLabel="Add item"
                  triggerVariant="secondary"
                  title="Add agenda item"
                  submitLabel="Add item"
                  action={addAgendaItem}
                  extraValues={{ meetingId: meeting.id }}
                  fields={[
                    { name: "title", label: "Item", type: "text", required: true },
                    {
                      name: "kind",
                      label: "Type",
                      type: "select",
                      required: true,
                      colSpan: 1,
                      defaultValue: "discussion",
                      options: [
                        { value: "information", label: "Information" },
                        { value: "discussion", label: "Discussion" },
                        { value: "decision", label: "Decision" },
                      ],
                    },
                    {
                      name: "timeBoxMinutes",
                      label: "Time box (minutes)",
                      type: "number",
                      colSpan: 1,
                    },
                  ]}
                />
              ) : null}
            </div>
            {(agenda ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No agenda items yet. Invitees can propose items; the organizer
                accepts and orders them.
              </p>
            ) : (
              <ol className="card divide-y divide-line">
                {((agenda ?? []) as unknown as AgendaItem[]).map((item, index) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 text-center text-[12.5px] font-semibold text-muted">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                      {item.title}
                    </span>
                    {item.time_box_minutes ? (
                      <span className="meta whitespace-nowrap">
                        {item.time_box_minutes} min
                      </span>
                    ) : null}
                    <Badge tone={KIND_TONES[item.kind]}>{item.kind}</Badge>
                    {item.status === "proposed" ? (
                      <Badge tone="warning">Proposed</Badge>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Notes */}
          <section aria-labelledby="notes-heading">
            <h2 id="notes-heading" className="section-heading mb-3">
              Notes
            </h2>
            {session.isStaff && !isCancelled ? (
              <MeetingNotesForm meetingId={meeting.id} initialNotes={meeting.notes} />
            ) : meeting.notes ? (
              <p className="card p-4 text-[13.5px] whitespace-pre-wrap">
                {meeting.notes}
              </p>
            ) : (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                No notes captured yet.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-8">
          {/* Decisions (P0-MTG-02) */}
          <section aria-labelledby="decisions-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="decisions-heading" className="section-heading flex items-center gap-1.5">
                <Gavel className="size-4 text-muted" aria-hidden />
                Decisions
              </h2>
              {session.isStaff && !isCancelled ? (
                <EntityFormDialog
                  triggerLabel="Record"
                  triggerVariant="secondary"
                  title="Record decision"
                  submitLabel="Record decision"
                  action={recordDecision}
                  extraValues={{ meetingId: meeting.id }}
                  fields={[
                    { name: "title", label: "Decision", type: "text", required: true },
                    { name: "detail", label: "Context", type: "textarea" },
                  ]}
                />
              ) : null}
            </div>
            {(decisions ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                Decisions recorded here enter the organization decision log.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {((decisions ?? []) as unknown as Decision[]).map((decision) => (
                  <li key={decision.id} className="px-4 py-2.5">
                    <p className="text-[13.5px] font-medium">{decision.title}</p>
                    {decision.detail ? (
                      <p className="meta mt-0.5">{decision.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Actions → tasks (CAL-004) */}
          <section aria-labelledby="actions-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="actions-heading" className="section-heading flex items-center gap-1.5">
                <ListChecks className="size-4 text-muted" aria-hidden />
                Actions
              </h2>
              {session.isStaff && !isCancelled ? (
                <EntityFormDialog
                  triggerLabel="Add action"
                  triggerVariant="secondary"
                  title="Add action"
                  submitLabel="Create task"
                  action={addMeetingAction}
                  extraValues={{ meetingId: meeting.id }}
                  fields={[
                    { name: "title", label: "Action", type: "text", required: true },
                    {
                      name: "ownerId",
                      label: "Owner",
                      type: "select",
                      colSpan: 1,
                      options: options.people.map((p) => ({ value: p.id, label: p.label })),
                    },
                    { name: "dueAt", label: "Due date", type: "date", colSpan: 1 },
                  ]}
                />
              ) : null}
            </div>
            {(actions ?? []).length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">
                Actions become assigned tasks in My Work.
              </p>
            ) : (
              <ul className="card divide-y divide-line">
                {((actions ?? []) as unknown as MeetingAction[]).map((action) => (
                  <li key={action.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 text-[13.5px]">{action.title}</span>
                    {action.due_at ? (
                      <span className="meta whitespace-nowrap">
                        {formatDate(action.due_at)}
                      </span>
                    ) : null}
                    {action.owner ? (
                      <Avatar
                        name={action.owner.full_name}
                        src={action.owner.avatar_url}
                        size="sm"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
