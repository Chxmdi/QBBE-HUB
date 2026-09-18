"use client";

import { Avatar } from "@/components/ui/avatar";
import { describeChange, type TaskFieldChange } from "@/features/tasks/services/task.history";
import { relativeTime } from "@/lib/utils";

export interface TaskHistoryEntry {
  id: string;
  verb: string;
  summary: string;
  createdAt: string;
  actorName: string | null;
  actorAvatar: string | null;
  changes: TaskFieldChange[];
}

/**
 * Who changed what, and when (P0-TSK-05).
 *
 * Entries render from the change list stored on the event rather than by
 * re-reading the task, so the history keeps saying what it said at the time —
 * including the former owner of a task that has since been reassigned.
 */
export function TaskHistory({
  entries,
  failed = false,
}: {
  entries: TaskHistoryEntry[];
  failed?: boolean;
}) {
  return (
    <section aria-labelledby="drawer-history">
      <h3 id="drawer-history" className="section-heading mb-2">
        History
      </h3>
      {failed ? (
        // "No recorded changes yet" would be a claim about the record. This is
        // a claim about the request, which is the only thing that is known.
        <p role="alert" className="text-[13px] text-danger-fg">
          The history could not be loaded. Nothing has been changed or lost —
          reopen this task to try again.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-muted">
          No recorded changes yet. Owner, due date, status, priority and project
          changes appear here with who made them.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-2.5">
              <Avatar
                name={entry.actorName ?? "Unknown"}
                src={entry.actorAvatar}
                size="sm"
                className="mt-0.5"
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold">
                    {entry.actorName ?? "Unknown"}
                  </span>
                  <span className="meta">{relativeTime(entry.createdAt)}</span>
                </p>
                {entry.changes.length > 0 ? (
                  <ul className="text-[13.5px]">
                    {entry.changes.map((change) => (
                      <li key={change.field}>{describeChange(change)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13.5px]">{entry.summary}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
