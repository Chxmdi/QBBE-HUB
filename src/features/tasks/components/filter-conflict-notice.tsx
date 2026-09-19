import { TriangleAlert } from "lucide-react";

/**
 * Say when the filters cannot match anything (P0-TSK-08).
 *
 * Returning zero rows for `status=ready&blocked=yes` is the right answer — no
 * task holds two statuses. The defect was that the page then printed "No
 * tasks", which reads as "there is no work" rather than "you asked a question
 * with no possible answer". The two are indistinguishable to the reader and
 * lead to opposite conclusions.
 *
 * Rendered above the list rather than replacing it, because the rest of the
 * page — the review queue, meetings — is still answering correctly.
 */
export function FilterConflictNotice({ conflicts }: { conflicts: string[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div
      role="status"
      className="mb-4 flex gap-2.5 rounded-(--radius-sm) border border-warning/25 bg-warning/10 px-3.5 py-2.5"
    >
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-warning-fg"
        aria-hidden="true"
      />
      <div className="text-[13px] text-warning-fg">
        <p className="font-medium">
          These filters cannot match anything, so the list below is empty for
          that reason rather than because there is no work.
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {conflicts.map((conflict) => (
            <li key={conflict}>{conflict}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
