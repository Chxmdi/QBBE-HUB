"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { saveDecisionRecord } from "../services/decision-v2.commands";
import type { DecisionRecord } from "../services/decision-v2.queries";
import { useDecisionsV2T } from "./use-dv2-t";

/** Edits the full record. Shown only to people who can manage the decision. */
export function DecisionRecordForm({ decision }: { decision: DecisionRecord }) {
  const t = useDecisionsV2T();
  const router = useRouter();
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const result = await saveDecisionRecord({
      decisionId: decision.id,
      title: String(form.get("title") ?? ""),
      problem: String(form.get("problem") ?? ""),
      options: String(form.get("options") ?? ""),
      evidence: String(form.get("evidence") ?? ""),
      reasoning: String(form.get("reasoning") ?? ""),
      revisitOn: String(form.get("revisitOn") ?? ""),
    });
    setSaving(false);
    setStatus({ ok: result.ok, text: result.ok ? t("form.saved") : (result.error ?? t("form.error")) });
    if (result.ok) router.refresh();
  }

  const field = (name: string) => `${id}-${name}`;
  return (
    <form onSubmit={submit} className="card space-y-4 p-4" aria-labelledby={field("heading")}>
      <h2 id={field("heading")} className="section-heading">{t("form.heading")}</h2>
      <div>
        <Label htmlFor={field("title")}>{t("fields.chosen")}</Label>
        <Input id={field("title")} name="title" defaultValue={decision.title} required maxLength={300} />
      </div>
      <div>
        <Label htmlFor={field("problem")}>{t("fields.problem")}</Label>
        <Textarea id={field("problem")} name="problem" defaultValue={decision.problem ?? ""} maxLength={4000} rows={3} />
      </div>
      <div>
        <Label htmlFor={field("options")}>{t("fields.options")}</Label>
        <Textarea
          id={field("options")}
          name="options"
          defaultValue={decision.options.join("\n")}
          rows={4}
          aria-describedby={field("options-hint")}
        />
        <div id={field("options-hint")}><FieldHint>{t("fields.optionsHint")}</FieldHint></div>
      </div>
      <div>
        <Label htmlFor={field("evidence")}>{t("fields.evidence")}</Label>
        <Textarea id={field("evidence")} name="evidence" defaultValue={decision.evidence ?? ""} maxLength={4000} rows={3} />
      </div>
      <div>
        <Label htmlFor={field("reasoning")}>{t("fields.reasoning")}</Label>
        <Textarea id={field("reasoning")} name="reasoning" defaultValue={decision.reasoning ?? ""} maxLength={4000} rows={3} />
      </div>
      <div>
        <Label htmlFor={field("revisit")}>{t("fields.revisit")}</Label>
        <Input
          id={field("revisit")}
          name="revisitOn"
          type="date"
          defaultValue={decision.revisitOn ?? ""}
          aria-describedby={field("revisit-hint")}
          className="max-w-48"
        />
        <div id={field("revisit-hint")}><FieldHint>{t("fields.revisitHint")}</FieldHint></div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {status ? (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-[12.5px] text-success-fg" : "text-[12.5px] text-danger-fg"}>
            {status.text}
          </span>
        ) : null}
        <Button type="submit" loading={saving}>{t("form.save")}</Button>
      </div>
    </form>
  );
}
