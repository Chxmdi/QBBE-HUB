"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { addDecisionParticipant, removeDecisionParticipant } from "../services/decision-v2.commands";
import { useDecisionsV2T } from "./use-dv2-t";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

type Person = { id: string; name: string };

export function ParticipantsEditor({
  decisionId,
  participants,
  people,
  canManage,
}: {
  decisionId: string;
  participants: Person[];
  people: Person[];
  canManage: boolean;
}) {
  const t = useDecisionsV2T();
  const shellT = useT();
  const router = useRouter();
  const id = useId();
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const present = new Set(participants.map((p) => p.id));

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    // Busy always clears; a failed request shows a translated message.
    const result = await runServerAction(action, { setBusy, setError, t: shellT, reload: () => window.location.reload() });
    if (!result) return;
    if (!result.ok) setError(result.error ?? t("participants.error"));
    else router.refresh();
  }

  return (
    <div className="space-y-3">
      {participants.length === 0 ? (
        <p className="text-sm text-muted">{t("participants.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {participants.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink">
              {p.name}
              {canManage ? (
                <button
                  type="button"
                  className="ml-1 inline-flex size-6 items-center justify-center rounded-full text-muted hover:bg-surface-soft"
                  aria-label={t("participants.remove", { name: p.name })}
                  disabled={busy}
                  onClick={() => void run(() => removeDecisionParticipant({ decisionId, userId: p.id }))}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) void run(() => addDecisionParticipant({ decisionId, userId: chosen }));
          }}
        >
          <div className="min-w-48 flex-1">
            <Label htmlFor={`${id}-person`}>{t("participants.person")}</Label>
            <Select id={`${id}-person`} value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">{t("participants.choose")}</option>
              {people.filter((p) => !present.has(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" disabled={!chosen} loading={busy}>{t("participants.add")}</Button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-[12.5px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
