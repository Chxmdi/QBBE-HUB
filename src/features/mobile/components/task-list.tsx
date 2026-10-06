"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { updateTaskStatus } from "@/features/tasks/services/task.commands";
import { useFormatters } from "@/lib/i18n/client";
import type { PhoneTask } from "../services/mobile.queries";
import { usePhoneStatus } from "./phone-status";
import { useMobileT } from "./use-mobile-t";

/** Tasks with a large "done" button each, uses the ordinary task action. */
export function TaskList({ tasks }: { tasks: PhoneTask[] }) {
  const t = useMobileT();
  const format = useFormatters();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // On the phone screens the layout shows it, so it survives the refresh below.
  const phoneStatus = usePhoneStatus();
  const setStatus = phoneStatus ?? setLocalStatus;
  const status = phoneStatus ? null : localStatus;

  async function done(task: PhoneTask) {
    setBusy(task.id);
    const result = await updateTaskStatus(task.id, "completed");
    setBusy(null);
    setStatus({ ok: result.ok, text: result.ok ? t("tasks.marked") : (result.error ?? t("tasks.error")) });
    if (result.ok) router.refresh();
  }

  return (
    <>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="card flex items-center gap-3 p-3">
            <button
              type="button"
              onClick={() => done(task)}
              disabled={busy === task.id}
              aria-label={t("tasks.done", { title: task.title })}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-muted hover:bg-surface-soft disabled:opacity-50"
            >
              <Check className="size-5" aria-hidden />
            </button>
            <div className="min-w-0">
              <p className="break-words text-sm text-ink">{task.title}</p>
              <p className="text-[12.5px] text-muted">
                {task.dueOn ? t("tasks.due", { date: format.date(`${task.dueOn}T12:00:00Z`, "UTC") }) : t("tasks.noDue")}
                {task.project ? ` · ${task.project}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {status ? (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "mt-2 text-[12.5px] text-success-fg" : "mt-2 text-[12.5px] text-danger-fg"}>
          {status.text}
        </p>
      ) : null}
    </>
  );
}
