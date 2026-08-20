import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { createEvent } from "@/features/events/services/event.commands";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import type { EventRecord } from "@/types/entities";

export const metadata: Metadata = { title: "Events" };
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
  const supabase = await createSupabaseServerClient();

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
            {formatDateTime(event.starts_at)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>
        {event.volunteer_need ? (
          <span className="meta flex items-center gap-1">
            <Users className="size-3.5" aria-hidden />
            {event.volunteer_need} volunteers
          </span>
        ) : null}
        <Badge tone={STATUS_TONES[event.status]}>
          {event.status.replace(/_/g, " ")}
        </Badge>
      </li>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Program events"
        title="Events"
        description="Logistics, volunteer needs, and communication for QBBE events."
        actions={
          session.isStaff ? (
            <EntityFormDialog
              triggerLabel="New event"
              title="Create event"
              submitLabel="Create event"
              defaultOpen={params.create === "1"}
              action={createEvent}
              fields={[
                { name: "name", label: "Name", type: "text", required: true },
                { name: "description", label: "Description", type: "textarea" },
                {
                  name: "programId",
                  label: "Program",
                  type: "select",
                  colSpan: 1,
                  options: (programs ?? []).map((p) => ({ value: p.id, label: p.name })),
                },
                {
                  name: "projectId",
                  label: "Project",
                  type: "select",
                  colSpan: 1,
                  options: (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
                },
                { name: "startsAt", label: "Starts", type: "datetime-local", required: true, colSpan: 1 },
                { name: "endsAt", label: "Ends (defaults to one hour)", type: "datetime-local", colSpan: 1 },
                { name: "location", label: "Location", type: "text", colSpan: 1 },
                {
                  name: "volunteerNeed",
                  label: "Volunteers needed",
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
            Upcoming
          </h2>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title="No upcoming events"
              description="Create an event to coordinate logistics, volunteers, and communication."
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
              Past events
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
