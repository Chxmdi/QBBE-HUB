import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { calendarDateInZone } from "@/lib/time";
import { mobileT } from "@/features/mobile/i18n";
import { dueGroup } from "@/features/mobile/group";
import { myMeetingsToday, myOpenTasks } from "@/features/mobile/services/mobile.queries";
import { TaskList } from "@/features/mobile/components/task-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: mobileT(await getLocale())("today.title") };
}

export default async function PhoneToday() {
  const session = await requireSession();
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = mobileT(locale);
  const today = calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10);
  const [tasks, meetings] = await Promise.all([
    myOpenTasks(session.userId),
    myMeetingsToday(session.userId, session.timeZone),
  ]);
  const overdue = tasks.filter((task) => dueGroup(task.dueOn, today) === "overdue");
  const dueToday = tasks.filter((task) => dueGroup(task.dueOn, today) === "today");

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("today.title")}</h1>
      {overdue.length > 0 ? (
        <section aria-labelledby="m-overdue" className="space-y-2">
          <h2 id="m-overdue" className="section-heading text-danger-fg">{t("today.overdue")}</h2>
          <TaskList tasks={overdue} />
        </section>
      ) : null}
      <section aria-labelledby="m-due-today" className="space-y-2">
        <h2 id="m-due-today" className="section-heading">{t("today.dueToday")}</h2>
        {dueToday.length === 0 ? <p className="text-sm text-muted">{t("today.nothing")}</p> : <TaskList tasks={dueToday} />}
      </section>
      <section aria-labelledby="m-meetings" className="space-y-2">
        <h2 id="m-meetings" className="section-heading">{t("today.meetings")}</h2>
        {meetings.length === 0 ? (
          <p className="text-sm text-muted">{t("today.noMeetings")}</p>
        ) : (
          <ul className="space-y-2">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="card flex min-h-12 items-center justify-between gap-3 p-3 text-sm">
                  <span className="break-words text-ink">{m.title}</span>
                  <span className="shrink-0 text-muted">{format.time(m.startsAt, session.timeZone)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
