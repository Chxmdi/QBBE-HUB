/** Run outcomes the history can be narrowed to (U10). Pure, so browser code can use it. */
export const runOutcomes = ["running", "waiting", "succeeded", "skipped", "failed", "stopped"] as const;
export type RunOutcomeFilter = (typeof runOutcomes)[number];

export function parseOutcomeFilter(raw: string | undefined): RunOutcomeFilter | null {
  return (runOutcomes as readonly string[]).includes(raw ?? "") ? (raw as RunOutcomeFilter) : null;
}
