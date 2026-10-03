import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { createEvent } from "@/features/events/services/event.commands";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { EventRecord } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("events.title") };
}
export const dynamic = "force-dynamic";

const STATUS_TONES = {
  planning: "warning",
  confirmed: "info",
  in_progress: "brand",
  completed: "success",
  cancelled: "neutral",
} as const;

function eventListCutoff() {
  return Date.now() - 3600_000;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const supabase = await createSupabasePageClient();

  const [{ data: events }, { data: programs }, { data: projects }] =
    await Promise.all([
      supabase
        .from("event")
        .select(
          "id, program_id, project_id, name, description, owner_id, event_type, starts_at, ends_at, location, status, volunteer_need, " +
            "owner:owner_id(id, full_name, email, avatar_url, title, timezone)",
        )
        .order("starts_at", { ascending: false })
        .limit(50),
      supabase.from("program").select("id, name").eq("status", "active").order("name"),
      supabase
        .from("project")
        .select("id, name")
        .is("archived_at", null)
        .in("stage", ["approved", "planning", "active"])
        .order("name"),
    ]);

  const eventList = (events ?? []) as unknown as EventRecord[];
  const cutoff = eventListCutoff();
  const upcoming = eventList
    .filter((e) => new Date(e.starts_at).getTime() >= cutoff)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = eventList.filter(
    (e) => new Date(e.starts_at).getTime() < cutoff,
  );

  function EventRow({ event }: { event: EventRecord }) {
    return (
      <li className="interactive-row flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-52">
          <Link
            href={`/events/${event.id}`}
            className="text-[14px] font-medium hover:text-brand-fg"
          >
            {event.name}
          </Link>
          <p className="meta">
            {format.dateTime(event.starts_at)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>
        {event.volunteer_need ? (
          <span className="meta flex items-center gap-1">
            <Users className="size-3.5" aria-hidden />
            {t(event.volunteer_need === 1 ? "events.volunteersOne" : "events.volunteersOther", {
              count: event.volunteer_need,
            })}
          </span>
        ) : null}
        <Badge tone={STATUS_TONES[event.status]}>
          {t(`events.statusBadges.${event.status}`)}
        </Badge>
      </li>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("events.eyebrow")}
        title={t("events.title")}
        description={t("events.description")}
        actions={
          session.isStaff && !session.isAdmin && (programs ?? []).length === 0 && (projects ?? []).length === 0 ? (
            // An event outside a program or project is for administrators.
            <p className="meta max-w-xs text-right">{t("events.create.needWorkFirst")}</p>
          ) : session.isStaff ? (
            <EntityFormDialog
              triggerLabel={t("events.create.trigger")}
              title={t("events.create.title")}
              submitLabel={t("events.create.submit")}
              defaultOpen={params.create === "1"}
              action={createEvent}
              fields={[
                { name: "name", label: t("events.fields.name"), type: "text", required: true },
                { name: "description", label: t("events.fields.description"), type: "textarea" },
                {
                  name: "programId",
                  label: t("events.fields.program"),
                  type: "select",
                  colSpan: 1,
                  // One of program or project is needed unless an administrator
                  // creates it (createEvent); say so before anything is typed.
                  hint: session.isAdmin ? undefined : t("events.create.workHint"),
                  options: (programs ?? []).map((p) => ({ value: p.id, label: p.name })),
                },
                {
                  name: "projectId",
                  label: t("events.fields.project"),
                  type: "select",
                  colSpan: 1,
                  options: (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
                },
                { name: "startsAt", label: t("events.fields.starts"), type: "datetime-local", required: true, colSpan: 1 },
                { name: "endsAt", label: t("events.fields.endsDefault"), type: "datetime-local", colSpan: 1 },
                { name: "location", label: t("events.fields.location"), type: "text", colSpan: 1 },
                // `createEvent` has always accepted a type and the edit form has
                // always shown one; only the create dialog left it out, so the
                // type could be set on an event but never given to one
                // (P0-EVT-01 asks for it on the record).
                { name: "eventType", label: t("events.fields.eventType"), type: "text", colSpan: 1 },
                {
                  name: "volunteerNeed",
                  label: t("events.fields.volunteersNeeded"),
                  type: "number",
                  colSpan: 1,
                },
              ]}
            />
          ) : undefined
        }
      />

      <div className="space-y-8">
        <section aria-labelledby="upcoming-events">
          <h2 id="upcoming-events" className="section-heading mb-3">
            {t("events.upcoming")}
          </h2>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title={t("events.emptyTitle")}
              description={t("events.emptyDescription")}
            />
          ) : (
            <ul className="card divide-y divide-line">
              {upcoming.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          )}
        </section>

        {past.length > 0 ? (
          <section aria-labelledby="past-events">
            <h2 id="past-events" className="section-heading mb-3">
              {t("events.past")}
            </h2>
            <ul className="card divide-y divide-line">
              {past.slice(0, 10).map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
