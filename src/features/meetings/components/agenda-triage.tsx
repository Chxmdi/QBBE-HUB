"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  moveAgendaItem,
  triageAgendaItem,
} from "@/features/meetings/services/meeting.commands";
import { useT } from "@/lib/i18n/client";

type Decision = "accepted" | "deferred" | "declined" | "done";

/**
 * The organizer's controls on one agenda item.
 *
 * Which actions are offered depends on where the item already is. A proposed
 * item needs a yes or no; an accepted one needs marking done or pushing to the
 * next meeting. Showing all four states at all times would make triage look
 * like a status dropdown, and the point of the requirement is that somebody
 * decides.
 */
export function AgendaTriage({
  agendaItemId,
  status,
  title,
  canMoveUp,
  canMoveDown,
}: {
  agendaItemId: string;
  status: string;
  title: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    if (
      decision === "declined" &&
      !window.confirm(t("meetings.triage.confirmDecline", { title }))
    ) return;
    setError(null);
    setBusy(true);
    const result = await triageAgendaItem({ agendaItemId, decision });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("meetings.triage.updateError"));
      return;
    }
    router.refresh();
  }

  async function move(direction: "up" | "down") {
    setError(null);
    setBusy(true);
    const result = await moveAgendaItem({ agendaItemId, direction });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("meetings.triage.reorderError"));
      return;
    }
    router.refresh();
  }

  const decisions: { label: string; value: Decision }[] =
    status === "proposed"
      ? [
          { label: t("meetings.triage.accept"), value: "accepted" },
          { label: t("meetings.triage.defer"), value: "deferred" },
          { label: t("meetings.triage.decline"), value: "declined" },
        ]
      : status === "accepted"
        ? [
            { label: t("meetings.triage.markDone"), value: "done" },
            { label: t("meetings.triage.defer"), value: "deferred" },
          ]
        : [{ label: t("meetings.triage.accept"), value: "accepted" }];

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        onClick={() => move("up")}
        disabled={!canMoveUp || busy}
        aria-label={t("meetings.triage.moveUp", { title })}
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        onClick={() => move("down")}
        disabled={!canMoveDown || busy}
        aria-label={t("meetings.triage.moveDown", { title })}
      >
        ↓
      </Button>
      {decisions.map((d) => (
        <Button
          key={d.value}
          variant="ghost"
          onClick={() => decide(d.value)}
          loading={busy}
          aria-label={t("meetings.triage.actionOn", { action: d.label, title })}
        >
          {d.label}
        </Button>
      ))}
      {error ? (
        <span role="alert" className="text-[12px] text-danger-fg">
          {error}
        </span>
      ) : null}
    </div>
  );
}
