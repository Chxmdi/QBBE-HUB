"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { createTask } from "@/features/tasks/services/task.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";
import { useMobileT } from "./use-mobile-t";

/** Quick capture: a task for yourself, through the ordinary create-task action. */
export function CaptureForm({ userId, projects }: { userId: string; projects: { id: string; name: string }[] }) {
  const t = useMobileT();
  const shellT = useT();
  const router = useRouter();
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const dueAt = String(form.get("dueAt") ?? "");
    const result = await runServerAction(
      () =>
        createTask({
          title: String(form.get("title") ?? ""),
          projectId: String(form.get("projectId") ?? "") || undefined,
          assigneeId: userId,
          dueAt: dueAt || undefined,
        }),
      { setBusy: setSaving, setError: (text) => setStatus(text ? { ok: false, text } : null), t: shellT, reload: () => window.location.reload() },
    );
    if (!result) return;
    setStatus({ ok: result.ok, text: result.ok ? t("capture.added") : (result.error ?? "") });
    if (result.ok) {
      formElement.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <div>
        <Label htmlFor={`${id}-title`}>{t("capture.titleLabel")}</Label>
        <Input id={`${id}-title`} name="title" required maxLength={300} className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor={`${id}-project`}>{t("capture.projectLabel")}</Label>
        <Select id={`${id}-project`} name="projectId" required defaultValue="" className="h-12 text-base" aria-describedby={`${id}-project-hint`}>
          <option value="" disabled>{t("capture.chooseProject")}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div id={`${id}-project-hint`}><FieldHint>{t("capture.projectHint")}</FieldHint></div>
      </div>
      <div>
        <Label htmlFor={`${id}-due`}>{t("capture.dueLabel")}</Label>
        <Input id={`${id}-due`} name="dueAt" type="date" className="h-12 text-base" />
      </div>
      <Button type="submit" loading={saving} className="h-12 w-full text-base">{t("capture.submit")}</Button>
      {status ? (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "text-sm text-success-fg" : "text-sm text-danger-fg"}>
          {status.text}
        </p>
      ) : null}
    </form>
  );
}
