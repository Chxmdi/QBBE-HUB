"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rescheduleCalendarItem } from "@/features/tasks/services/planning.commands";
import { cn } from "@/lib/utils";

/**
 * Move one task or milestone to another date (P1-TSK-12).
 *
 * A date field rather than a drag handle. Dragging is the usual way to
 * reschedule in a calendar and it is unreachable by keyboard, unusable with a
 * screen reader and awkward on touch; the board solved the same problem by
 * pairing its drag with a status select, and this is the calendar's equivalent
 * — except that here the accessible control is the only one, so there is no
 * second path that can quietly become the real one.
 *
 * The value sent is the calendar date the person picked, never an instant. The
 * columns behind both records are `date`, so converting to a timestamp and
 * back is the only way to get this wrong, and it is the way that puts work on
 * the wrong side of midnight for everyone west of the workspace.
 */
export function RescheduleControl({
  kind,
  id,
  label,
  date,
}: {
  kind: "task" | "milestone";
  id: string;
  label: string;
  /** Current date as `yyyy-MM-dd`, already resolved in the workspace's zone. */
  date: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function move(next: string) {
    if (!next || next === date) return;
    setError(null);
    startTransition(async () => {
      const result = await rescheduleCalendarItem({ kind, id, date: next });
      if (!result.ok) {
        // Say what failed and leave the field showing the real date. A control
        // that silently snaps back looks like the app lost the change.
        setError(result.error ?? "Could not move that item.");
        setAnnouncement(`${label} was not moved. ${result.error ?? ""}`.trim());
        return;
      }
      setAnnouncement(`${label} moved to ${next}.`);
      router.refresh();
    });
  }

  return (
    <span className="mt-1 block">
      <label className="sr-only" htmlFor={`reschedule-${kind}-${id}`}>
        Reschedule {label}
      </label>
      <input
        id={`reschedule-${kind}-${id}`}
        type="date"
        defaultValue={date}
        disabled={pending}
        onChange={(e) => move(e.target.value)}
        className={cn(
          "w-full rounded border border-line bg-surface px-1 py-0.5 text-[10.5px]",
          pending && "opacity-60",
          error && "border-danger",
        )}
      />
      {error ? (
        <span className="mt-0.5 block text-[10px] text-danger-fg">{error}</span>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </span>
  );
}
