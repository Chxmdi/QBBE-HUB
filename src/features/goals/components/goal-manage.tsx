"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { linkToGoal, setGoalStatus, unlinkFromGoal } from "../services/goal.commands";
import type { GoalStatus } from "../services/goal.queries";
import { useGoalsT } from "./use-goals-t";

type Option = { id: string; name: string };

function useRun() {
  const router = useRouter();
  const t = useGoalsT();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(action: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setMessage({ ok: false, text: result.error ?? t("links.error") });
    else {
      if (success) setMessage({ ok: true, text: success });
      router.refresh();
    }
  }
  return { busy, message, run };
}

function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-[12.5px] text-success-fg" : "text-[12.5px] text-danger-fg"}>
      {message.text}
    </p>
  );
}

export function GoalStatusForm({ goalId, status }: { goalId: string; status: GoalStatus }) {
  const t = useGoalsT();
  const id = useId();
  const [value, setValue] = useState<GoalStatus>(status);
  const { busy, message, run } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setGoalStatus({ goalId, status: value }), t("status_form.saved"));
      }}
    >
      <div>
        <Label htmlFor={id}>{t("status_form.label")}</Label>
        <Select id={id} value={value} onChange={(e) => setValue(e.target.value as GoalStatus)}>
          {(["active", "achieved", "dropped"] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
      </div>
      <Button type="submit" variant="secondary" loading={busy}>{t("status_form.save")}</Button>
      <Message message={message} />
    </form>
  );
}

export function GoalLinkForm({ goalId, kind, options }: { goalId: string; kind: "project" | "metric"; options: Option[] }) {
  const t = useGoalsT();
  const id = useId();
  const [chosen, setChosen] = useState("");
  const { busy, message, run } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen) run(() => linkToGoal({ goalId, kind, refId: chosen }));
      }}
    >
      <div className="min-w-48 flex-1">
        <Label htmlFor={id}>{kind === "project" ? t("links.projectLabel") : t("links.metricLabel")}</Label>
        <Select id={id} value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">{kind === "project" ? t("links.chooseProject") : t("links.chooseMetric")}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </div>
      <Button type="submit" variant="secondary" disabled={!chosen} loading={busy}>
        {kind === "project" ? t("links.addProject") : t("links.addMetric")}
      </Button>
      <Message message={message} />
    </form>
  );
}

export function UnlinkButton({ goalId, kind, refId, name }: { goalId: string; kind: "project" | "metric"; refId: string; name: string }) {
  const t = useGoalsT();
  const { busy, message, run } = useRun();
  return (
    <>
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-surface-soft"
        aria-label={t("links.unlink", { name })}
        disabled={busy}
        onClick={() => run(() => unlinkFromGoal({ goalId, kind, refId }))}
      >
        <X className="size-4" aria-hidden />
      </button>
      <Message message={message} />
    </>
  );
}
