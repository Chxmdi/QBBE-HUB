import type { Metadata } from "next";
import Link from "next/link";
import { Presentation } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { createMeeting } from "@/features/meetings/services/meeting.commands";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import type { Meeting } from "@/types/entities";

export const metadata: Metadata = { title: "Meetings" };
export const dynamic = "force-dynamic";

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: upcoming }, { data: past }, { data: projects }] =
    await Promise.all([
      supabase
        .from("meeting")
        .select(
          "id, title, purpose, organizer_id, starts_at, ends_at, location, meeting_link, status, notes, channel_id, program_id, project_id, " +
            "organizer:organizer_id(id, full_name, email, avatar_url, title, timezone), project:project_id(id, name)",
        )
        .gte("starts_at", new Date(Date.now() - 3600_000).toISOString())
        .neq("status", "cancelled")
        .order("starts_at")
        .limit(30),
      supabase
        .from("meeting")
        .select(
          "id, title, purpose, organizer_id, starts_at, ends_at, location, meeting_link, status, notes, channel_id, program_id, project_id, " +
            "organizer:organizer_id(id, full_name, email, avatar_url, title, timezone), project:project_id(id, name)",
        )
        .lt("starts_at", new Date(Date.now() - 3600_000).toISOString())
        .order("starts_at", { ascending: false })
        .limit(15),
      supabase
        .from("project")
        .select("id, name")
        .is("archived_at", null)
        .in("stage", ["approved", "planning", "active"])
        .order("name"),
    ]);

  function MeetingRow({ meeting }: { meeting: Meeting }) {
    return (
      <li className="interactive-row flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-52">
          <Link
            href={`/meetings/${meeting.id}`}
            className="text-[14px] font-medium hover:text-brand-fg"
          >
            {meeting.title}
          </Link>
          <p className="meta">
            {formatDateTime(meeting.starts_at)}
            {meeting.project ? ` · ${meeting.project.name}` : ""}
            {meeting.location ? ` · ${meeting.location}` : ""}
          </p>
        </div>
        {meeting.status === "completed" ? (
          <Badge tone="success">Completed</Badge>
        ) : null}
        {meeting.organizer ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <Avatar
              name={meeting.organizer.full_name}
              src={meeting.organizer.avatar_url}
              size="sm"
            />
            {meeting.organizer.full_name}
          </span>
        ) : null}
      </li>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Meetings & agendas"
        title="Meetings"
        description="Agendas turn discussion into decisions; actions become assigned tasks."
        actions={
          session.isStaff ? (
            <EntityFormDialog
              triggerLabel="New meeting"
              title="Schedule meeting"
              submitLabel="Schedule"
              defaultOpen={params.create === "1"}
              action={createMeeting}
              fields={[
                { name: "title", label: "Title", type: "text", required: true },
                { name: "purpose", label: "Purpose", type: "textarea" },
                {
                  name: "projectId",
                  label: "Linked project",
                  type: "select",
                  colSpan: 1,
                  options: (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
                },
                { name: "startsAt", label: "Starts", type: "datetime-local", required: true, colSpan: 1 },
                {
                  name: "durationMinutes",
                  label: "Duration (minutes)",
                  type: "number",
                  colSpan: 1,
                  defaultValue: "60",
                },
                { name: "location", label: "Location", type: "text", colSpan: 1 },
                {
                  name: "meetingLink",
                  label: "Meeting link",
                  type: "url",
                  hint: "Google Meet, Zoom, Teams — any provider.",
                },
              ]}
            />
          ) : undefined
        }
      />

      <div className="space-y-8">
        <section aria-labelledby="upcoming-meetings">
          <h2 id="upcoming-meetings" className="section-heading mb-3">
            Upcoming
          </h2>
          {(upcoming ?? []).length === 0 ? (
            <EmptyState
              icon={<Presentation />}
              title="No upcoming meetings"
              description="Schedule a meeting to build an agenda, capture decisions, and assign actions."
            />
          ) : (
            <ul className="card divide-y divide-line">
              {((upcoming ?? []) as unknown as Meeting[]).map((meeting) => (
                <MeetingRow key={meeting.id} meeting={meeting} />
              ))}
            </ul>
          )}
        </section>

        {(past ?? []).length > 0 ? (
          <section aria-labelledby="past-meetings">
            <h2 id="past-meetings" className="section-heading mb-3">
              Recent
            </h2>
            <ul className="card divide-y divide-line">
              {((past ?? []) as unknown as Meeting[]).map((meeting) => (
                <MeetingRow key={meeting.id} meeting={meeting} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
