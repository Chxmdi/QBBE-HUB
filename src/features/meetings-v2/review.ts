import type { SemanticBlockKind } from "./editor-adapter";

export type ReviewChoice = "approve" | "dismiss";

export interface ReviewableCapture {
  id: string;
  kind: SemanticBlockKind;
  status: "open" | "approved" | "dismissed";
}

export type ReviewStep =
  | { captureId: string; op: "create_task" }
  | { captureId: string; op: "record_decision" }
  | { captureId: string; op: "keep" }
  | { captureId: string; op: "dismiss" };

/**
 * What the end-of-meeting review will do with each open capture.
 *
 * Tasks and follow-ups become tasks, decisions become decision records and
 * questions stay on the meeting. A capture with no choice is left open, and a
 * capture already reviewed is never touched again (the database refuses it
 * too), so applying the same review twice changes nothing.
 */
export function planReview(
  captures: ReviewableCapture[],
  choices: Record<string, ReviewChoice | undefined>,
): ReviewStep[] {
  const steps: ReviewStep[] = [];
  for (const capture of captures) {
    if (capture.status !== "open") continue;
    const choice = choices[capture.id];
    if (!choice) continue;
    if (choice === "dismiss") {
      steps.push({ captureId: capture.id, op: "dismiss" });
    } else if (capture.kind === "task" || capture.kind === "follow_up") {
      steps.push({ captureId: capture.id, op: "create_task" });
    } else if (capture.kind === "decision") {
      steps.push({ captureId: capture.id, op: "record_decision" });
    } else {
      steps.push({ captureId: capture.id, op: "keep" });
    }
  }
  return steps;
}

export function summarizeSteps(steps: ReviewStep[]): { created: number; kept: number; dismissed: number } {
  return {
    created: steps.filter((s) => s.op === "create_task" || s.op === "record_decision").length,
    kept: steps.filter((s) => s.op === "keep").length,
    dismissed: steps.filter((s) => s.op === "dismiss").length,
  };
}
