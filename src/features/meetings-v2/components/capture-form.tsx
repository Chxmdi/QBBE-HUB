"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { semanticBlockKinds, type SemanticBlockKind } from "../editor-adapter";
import { captureItem } from "../services/meeting-v2.commands";
import { useMeetingsV2T } from "./use-mv2-t";

export function CaptureForm({
  meetingId,
  people,
  agenda,
}: {
  meetingId: string;
  people: { id: string; name: string }[];
  agenda: { id: string; title: string }[];
}) {
  const t = useMeetingsV2T();
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState<SemanticBlockKind>("task");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const takesOwner = kind === "task" || kind === "follow_up";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    const result = await captureItem({
      meetingId,
      kind,
      body: String(form.get("body") ?? ""),
      ownerId: takesOwner ? String(form.get("ownerId") ?? "") : "",
      dueOn: takesOwner ? String(form.get("dueOn") ?? "") : "",
      agendaItemId: String(form.get("agendaItemId") ?? ""),
    });
    setSaving(false);
    setStatus({ ok: result.ok, text: result.ok ? (result.message ?? t("capture.added")) : (result.error ?? t("capture.error")) });
    if (result.ok) {
      formElement.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-2" aria-label={t("capture.add")}>
      <div>
        <Label htmlFor={`${id}-kind`}>{t("capture.kindLabel")}</Label>
        <Select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as SemanticBlockKind)}>
          {semanticBlockKinds.map((k) => (
            <option key={k} value={k}>{t(`kind.${k}`)}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${id}-agenda`}>{t("capture.agendaLabel")}</Label>
        <Select id={`${id}-agenda`} name="agendaItemId" defaultValue="">
          <option value="">{t("capture.noAgenda")}</option>
          {agenda.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${id}-body`}>{t("capture.bodyLabel")}</Label>
        <Input id={`${id}-body`} name="body" required maxLength={500} />
      </div>
      {takesOwner ? (
        <>
          <div>
            <Label htmlFor={`${id}-owner`}>{t("capture.ownerLabel")}</Label>
            <Select id={`${id}-owner`} name="ownerId" defaultValue="">
              <option value="">{t("capture.noOwner")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-due`}>{t("capture.dueLabel")}</Label>
            <Input id={`${id}-due`} name="dueOn" type="date" />
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2">
        {status ? (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-[12.5px] text-success-fg" : "text-[12.5px] text-danger-fg"}>
            {status.text}
          </span>
        ) : null}
        <Button type="submit" size="sm" loading={saving}>{t("capture.add")}</Button>
      </div>
    </form>
  );
}
