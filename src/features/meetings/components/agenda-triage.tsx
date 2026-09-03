"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  moveAgendaItem,
  triageAgendaItem,
} from "@/features/meetings/services/meeting.commands";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    if (
      decision === "declined" &&
      !window.confirm(`Decline "${title}"? It stays on the agenda marked declined.`)
    ) return;
    setError(null);
    setBusy(true);
    const result = await triageAgendaItem({ agendaItemId, decision });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not update the item.");
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
      setError(result.error ?? "Could not reorder the agenda.");
      return;
    }
    router.refresh();
  }

  const decisions: { label: string; value: Decision }[] =
    status === "proposed"
      ? [
          { label: "Accept", value: "accepted" },
          { label: "Defer", value: "deferred" },
          { label: "Decline", value: "declined" },
        ]
      : status === "accepted"
        ? [
            { label: "Mark done", value: "done" },
            { label: "Defer", value: "deferred" },
          ]
        : [{ label: "Accept", value: "accepted" }];

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        onClick={() => move("up")}
        disabled={!canMoveUp || busy}
        aria-label={`Move "${title}" earlier in the agenda`}
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        onClick={() => move("down")}
        disabled={!canMoveDown || busy}
        aria-label={`Move "${title}" later in the agenda`}
      >
        ↓
      </Button>
      {decisions.map((d) => (
        <Button
          key={d.value}
          variant="ghost"
          onClick={() => decide(d.value)}
          loading={busy}
          aria-label={`${d.label} "${title}"`}
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
