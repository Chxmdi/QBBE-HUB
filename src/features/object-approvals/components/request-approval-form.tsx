"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import type { ApprovableType } from "../contract";
import { requestObjectApproval } from "../services/object-approval.commands";
import { useObjectApprovalsT } from "./use-oa-t";

/** The "Request approval" action on a record. */
export function RequestApprovalForm({ type, id }: { type: ApprovableType; id: string }) {
  const t = useObjectApprovalsT();
  const router = useRouter();
  const fieldId = useId();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    const result = await requestObjectApproval({
      type,
      id,
      title: String(form.get("title") ?? ""),
      note: String(form.get("note") ?? ""),
    });
    setSaving(false);
    setStatus({ ok: result.ok, text: result.ok ? t("request.sent") : (result.error ?? t("request.error")) });
    if (result.ok) {
      formElement.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4" aria-labelledby={`${fieldId}-heading`}>
      <h2 id={`${fieldId}-heading`} className="section-heading">{t("request.heading")}</h2>
      <p className="text-[13px] text-muted">{t("request.hint")}</p>
      <div>
        <Label htmlFor={`${fieldId}-title`}>{t("request.titleLabel")}</Label>
        <Input id={`${fieldId}-title`} name="title" maxLength={200} aria-describedby={`${fieldId}-title-hint`} />
        <div id={`${fieldId}-title-hint`}><FieldHint>{t("request.titleHint")}</FieldHint></div>
      </div>
      <div>
        <Label htmlFor={`${fieldId}-note`}>{t("request.noteLabel")}</Label>
        <Textarea id={`${fieldId}-note`} name="note" maxLength={2000} rows={3} />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {status ? (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-[12.5px] text-success-fg" : "text-[12.5px] text-danger-fg"}>
            {status.text}
          </span>
        ) : null}
        <Button type="submit" loading={saving}>{t("request.submit")}</Button>
      </div>
    </form>
  );
}
