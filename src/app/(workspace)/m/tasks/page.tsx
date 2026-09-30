import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { calendarDateInZone } from "@/lib/time";
import { mobileT } from "@/features/mobile/i18n";
import { groupTasks } from "@/features/mobile/group";
import { myOpenTasks } from "@/features/mobile/services/mobile.queries";
import { TaskList } from "@/features/mobile/components/task-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: mobileT(await getLocale())("tasks.title") };
}

export default async function PhoneTasks() {
  const session = await requireSession();
  const t = mobileT(await getLocale());
  const today = calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10);
  const tasks = await myOpenTasks(session.userId);
  const groups = groupTasks(tasks, today);

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("tasks.title")}</h1>
      {tasks.length === 0 ? <p className="text-sm text-muted">{t("tasks.empty")}</p> : null}
      {(["overdue", "week", "later", "none"] as const).map((key) =>
        groups[key].length === 0 ? null : (
          <section key={key} aria-labelledby={`m-tasks-${key}`} className="space-y-2">
            <h2 id={`m-tasks-${key}`} className="section-heading">{t(`tasks.groups.${key}`)}</h2>
            <TaskList tasks={groups[key]} />
          </section>
        ),
      )}
    </div>
  );
}
