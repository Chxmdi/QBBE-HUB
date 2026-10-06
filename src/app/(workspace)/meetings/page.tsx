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
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { Meeting } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("meetings.title") };
}
export const dynamic = "force-dynamic";

function meetingListCutoff() {
  return new Date(Date.now() - 3600_000).toISOString();
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const supabase = await createSupabasePageClient();
  const cutoff = meetingListCutoff();

  const [{ data: upcoming }, { data: past }, { data: projects }, { data: agendas }] =
    await Promise.all([
      supabase
        .from("meeting")
        .select(
          "id, title, purpose, organizer_id, starts_at, ends_at, location, meeting_link, status, notes, channel_id, program_id, project_id, " +
            "organizer:organizer_id(id, full_name, email, avatar_url, title, timezone), project:project_id(id, name)",
        )
        .gte("starts_at", cutoff)
        .neq("status", "cancelled")
        .order("starts_at")
        .limit(30),
      supabase
        .from("meeting")
        .select(
          "id, title, purpose, organizer_id, starts_at, ends_at, location, meeting_link, status, notes, channel_id, program_id, project_id, " +
            "organizer:organizer_id(id, full_name, email, avatar_url, title, timezone), project:project_id(id, name)",
        )
        .lt("starts_at", cutoff)
        .order("starts_at", { ascending: false })
        .limit(15),
      supabase
        .from("project")
        .select("id, name")
        .is("archived_at", null)
        .in("stage", ["approved", "planning", "active"])
        .order("name"),
      supabase
        .from("agenda_template")
        .select("id, name")
        .not("approved_at", "is", null)
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
            {format.dateTime(meeting.starts_at)}
            {meeting.project ? ` · ${meeting.project.name}` : ""}
            {meeting.location ? ` · ${meeting.location}` : ""}
          </p>
        </div>
        {meeting.status === "completed" ? (
          <Badge tone="success">{t("meetings.completed")}</Badge>
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
        eyebrow={t("meetings.eyebrow")}
        title={t("meetings.title")}
        description={t("meetings.description")}
        actions={
          session.isStaff && !session.isAdmin && (projects ?? []).length === 0 ? (
            // A meeting outside a project is for administrators; without a
            // project to choose there is nothing this form could save.
            <p className="meta max-w-xs text-right">{t("meetings.create.needProjectFirst")}</p>
          ) : session.isStaff ? (
            <EntityFormDialog
              triggerLabel={t("meetings.create.trigger")}
              title={t("meetings.create.title")}
              submitLabel={t("meetings.create.submit")}
              defaultOpen={params.create === "1"}
              action={createMeeting}
              fields={[
                { name: "title", label: t("meetings.fields.title"), type: "text", required: true },
                { name: "purpose", label: t("meetings.fields.purpose"), type: "textarea" },
                {
                  name: "projectId",
                  label: t("meetings.fields.linkedProject"),
                  type: "select",
                  colSpan: 1,
                  // Optional only for administrators, as createMeeting decides.
                  required: !session.isAdmin,
                  hint: session.isAdmin ? undefined : t("meetings.create.projectHint"),
                  options: (projects ?? []).map((p) => ({
                    value: p.id,
                    label: p.name,
                  })),
                },
                {
                  name: "startsAt",
                  label: t("meetings.fields.starts"),
                  type: "datetime-local",
                  required: true,
                  colSpan: 1,
                },
                {
                  name: "durationMinutes",
                  label: t("meetings.fields.duration"),
                  type: "number",
                  colSpan: 1,
                  defaultValue: "60",
                },
                {
                  name: "location",
                  label: t("meetings.fields.location"),
                  type: "text",
                  colSpan: 1,
                },
                {
                  name: "repeat",
                  label: t("meetings.fields.repeats"),
                  type: "select",
                  colSpan: 1,
                  defaultValue: "none",
                  options: [
                    { value: "none", label: t("meetings.repeat.none") },
                    { value: "weekly", label: t("meetings.repeat.weekly") },
                    { value: "fortnightly", label: t("meetings.repeat.fortnightly") },
                    { value: "monthly", label: t("meetings.repeat.monthly") },
                  ],
                },
                {
                  name: "occurrences",
                  label: t("meetings.fields.occurrences"),
                  type: "number",
                  colSpan: 1,
                  hint: t("meetings.fields.occurrencesHint"),
                },
                {
                  name: "meetingLink",
                  label: t("meetings.fields.meetingLink"),
                  type: "url",
                  hint: t("meetings.fields.meetingLinkHint"),
                },
                {
                  name: "agendaTemplateId",
                  label: t("meetings.fields.agendaTemplate"),
                  type: "select",
                  options: (agendas ?? []).map((agenda) => ({
                    value: agenda.id,
                    label: agenda.name,
                  })),
                },
              ]}
            />
          ) : undefined
        }
      />

      <div className="space-y-8">
        <section aria-labelledby="upcoming-meetings">
          <h2 id="upcoming-meetings" className="section-heading mb-3">
            {t("meetings.upcoming")}
          </h2>
          {(upcoming ?? []).length === 0 ? (
            <EmptyState
              icon={<Presentation />}
              title={t("meetings.emptyTitle")}
              description={t("meetings.emptyDescription")}
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
              {t("meetings.recent")}
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
