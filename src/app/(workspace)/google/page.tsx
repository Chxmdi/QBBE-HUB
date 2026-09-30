import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { DriveLinkForm, EventToMeeting, ForwardToCapture } from "@/features/google-objects/components/google-controls";
import { requireGoogleObjects } from "@/features/google-objects/gate";
import { fill, googleObjectsText } from "@/features/google-objects/messages";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: googleObjectsText(await getLocale()).title };
}
export const dynamic = "force-dynamic";

export default async function GoogleObjectsPage() {
  await requireGoogleObjects();
  const session = await requireSession();
  const text = googleObjectsText(await getLocale());
  const format = await getFormatters();
  const supabase = await createSupabasePageClient();
  const nowIso = new Date().toISOString();
  // Every read is the person's own: these tables only ever show you your own rows.
  const [{ data: events }, { data: mail }, { data: captured }, { data: projects }] = await Promise.all([
    supabase
      .from("calendar_event_link")
      .select("id, title, starts_at")
      .eq("user_id", session.userId)
      .is("meeting_id", null)
      .is("event_id", null)
      .gte("starts_at", nowIso)
      .order("starts_at")
      .limit(20),
    supabase
      .from("gmail_message")
      .select("id, subject, from_address, received_at")
      .eq("user_id", session.userId)
      .order("received_at", { ascending: false })
      .limit(20),
    supabase
      .from("capture_forward")
      .select("id, source_id, title, sender, status")
      .eq("user_id", session.userId)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("project").select("id, name").is("archived_at", null).order("name").limit(500),
  ]);
  const projectList = (projects ?? []) as { id: string; name: string }[];
  const capturedIds = new Set(((captured ?? []) as { source_id: string }[]).map((c) => c.source_id));
  const when = (iso: string | null) => (iso ? format.inZone(iso, session.timeZone, { dateStyle: "medium", timeStyle: "short" }) : "");

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={text.eyebrow} title={text.title} description={text.description} />

      <section aria-labelledby="google-calendar" className="space-y-3">
        <h2 id="google-calendar" className="text-[15px] font-semibold">
          {text.calendarHeading}
        </h2>
        <p className="meta">{text.calendarHelp}</p>
        {(events ?? []).length === 0 ? (
          <p className="meta">{text.noEvents}</p>
        ) : (
          <ul className="space-y-3">
            {((events ?? []) as { id: string; title: string; starts_at: string }[]).map((event) => (
              <li key={event.id} className="card space-y-2 p-4">
                <p>
                  <span className="font-medium">{event.title}</span> <span className="meta">{when(event.starts_at)}</span>
                </p>
                <EventToMeeting linkId={event.id} name={event.title} projects={projectList} text={text} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="google-drive" className="card space-y-3 p-5">
        <h2 id="google-drive" className="text-[15px] font-semibold">
          {text.driveHeading}
        </h2>
        <p className="meta">{text.driveHelp}</p>
        <DriveLinkForm projects={projectList} text={text} />
      </section>

      <section aria-labelledby="google-gmail" className="space-y-3">
        <h2 id="google-gmail" className="text-[15px] font-semibold">
          {text.gmailHeading}
        </h2>
        <p className="meta">{text.gmailHelp}</p>
        {(mail ?? []).length === 0 ? (
          <p className="meta">{text.noMail}</p>
        ) : (
          <ul className="space-y-2">
            {((mail ?? []) as { id: string; subject: string | null; from_address: string | null; received_at: string | null }[]).map((m) => {
              const subject = m.subject?.trim() || text.noSubject;
              return (
                <li key={m.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="font-medium">{subject}</p>
                    <p className="meta">
                      {m.from_address ? fill(text.from, { sender: m.from_address }) : null} {when(m.received_at)}
                    </p>
                  </div>
                  {capturedIds.has(m.id) ? null : <ForwardToCapture messageId={m.id} name={subject} text={text} />}
                </li>
              );
            })}
          </ul>
        )}
        <h3 className="pt-2 text-[14px] font-semibold">{text.captured}</h3>
        {(captured ?? []).length === 0 ? (
          <p className="meta">{text.nothingCaptured}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {((captured ?? []) as { id: string; title: string; sender: string | null }[]).map((c) => (
              <li key={c.id}>
                {c.title}
                {c.sender ? <span className="meta"> · {fill(text.from, { sender: c.sender })}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
