/**
 * Revisit reminders (Workspace OS V1-10): who is told, and whether a decision
 * is due. Pure, so the job and its tests share one answer.
 */
export interface RevisitCandidate {
  revisit_on: string | null;
  revisit_reminded_at: string | null;
  reopened_at: string | null;
}

/** Due on or after its revisit day, not yet reminded for that day. */
export function isDueForRevisit(decision: RevisitCandidate, today: string): boolean {
  if (!decision.revisit_on || decision.revisit_reminded_at) return false;
  return decision.revisit_on <= today;
}

/** The decider and every participant, once each. Nobody when nobody is named. */
export function revisitRecipients(decidedBy: string | null, participantIds: string[]): string[] {
  return [...new Set([...(decidedBy ? [decidedBy] : []), ...participantIds])];
}

/** Options as stored: trimmed, non-empty, at most 20, each at most 500 characters. */
export function parseOptions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => line.slice(0, 500));
}
