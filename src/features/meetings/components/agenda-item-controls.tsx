"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import {
  carryForwardAgendaItem,
  combineAgendaItem,
  removeAgendaItem,
} from "@/features/meetings/services/meeting.commands";
import { useT } from "@/lib/i18n/client";

interface Option {
  id: string;
  label: string;
}

/**
 * Remove, combine and carry forward for one agenda item (P0-AGD-01/03,
 * P1-AGD-06). The database decides who may do each; these controls are shown
 * to the organizer's side of the meeting.
 */
export function AgendaItemControls({
  agendaItemId,
  title,
  status,
  otherItems,
  laterMeetings,
}: {
  agendaItemId: string;
  title: string;
  status: string;
  otherItems: Option[];
  laterMeetings: Option[];
}) {
  const router = useRouter();
  const t = useT();
  const [mode, setMode] = useState<"none" | "combine" | "carry">("none");
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unfinished = !["done", "declined", "combined"].includes(status);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("meetings.itemControls.failed"));
      return;
    }
    setMode("none");
    setChoice("");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {mode === "none" ? (
        <>
          {unfinished && otherItems.length > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setMode("combine")}
              aria-label={t("meetings.itemControls.combineAria", { title })}
            >
              {t("meetings.itemControls.combine")}
            </Button>
          ) : null}
          {unfinished && laterMeetings.length > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setMode("carry")}
              aria-label={t("meetings.itemControls.carryAria", { title })}
            >
              {t("meetings.itemControls.carryForward")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            loading={busy}
            aria-label={t("meetings.itemControls.removeAria", { title })}
            onClick={() => {
              if (window.confirm(t("meetings.itemControls.confirmRemove", { title }))) {
                void run(() => removeAgendaItem(agendaItemId));
              }
            }}
          >
            {t("meetings.itemControls.remove")}
          </Button>
        </>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              mode === "combine"
                ? combineAgendaItem({ agendaItemId, targetItemId: choice })
                : carryForwardAgendaItem({
                    agendaItemId,
                    targetMeetingId: choice,
                  }),
            );
          }}
        >
          <div>
            <Label htmlFor={`${mode}-${agendaItemId}`}>
              {mode === "combine"
                ? t("meetings.itemControls.combineInto")
                : t("meetings.itemControls.carryTo")}
            </Label>
            <Select
              id={`${mode}-${agendaItemId}`}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              required
            >
              <option value="">{t("meetings.itemControls.choose")}</option>
              {(mode === "combine" ? otherItems : laterMeetings).map(
                (option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ),
              )}
            </Select>
          </div>
          <Button type="submit" loading={busy}>
            {mode === "combine"
              ? t("meetings.itemControls.combine")
              : t("meetings.itemControls.carryForward")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode("none")}>
            {t("meetings.itemControls.cancel")}
          </Button>
        </form>
      )}
      {error ? (
        <span role="alert" className="text-[12px] text-danger-fg">
          {error}
        </span>
      ) : null}
    </div>
  );
}
