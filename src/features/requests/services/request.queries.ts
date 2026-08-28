import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOpenRequest } from "@/features/requests/schemas";
import type {
  ApprovalDecision,
  ProjectRequestStatus,
} from "@/features/requests/schemas";

/**
 * Reads for the intake queue.
 *
 * Everything runs as the signed-in person. A volunteer sees their own requests
 * and nothing else, a staff member sees the queue, and neither needs a role
 * check here — the policies already say so, and a second copy of that rule in
 * TypeScript is a second place for the two to disagree.
 */

interface Person {
  id: string;
  full_name: string;
}

export interface ProjectRequestRow {
  id: string;
  title: string;
  summary: string;
  rationale: string | null;
  beneficiaries: string | null;
  status: ProjectRequestStatus;
  needed_by: string | null;
  estimated_effort: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  project_id: string | null;
  requester: Person | null;
  sponsor: Person | null;
  decider: Person | null;
  program: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
}

export interface ApprovalRow {
  id: string;
  note: string | null;
  due_at: string | null;
  decision: ApprovalDecision;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  requester: Person | null;
  approver: Person | null;
  project_request: { id: string; title: string } | null;
  report: { id: string; title: string } | null;
  opportunity: { id: string; title: string; crm_organization_id: string } | null;
}

const REQUEST_SELECT =
  "id, title, summary, rationale, beneficiaries, status, needed_by, " +
  "estimated_effort, decision_note, decided_at, created_at, project_id, " +
  "requester:requested_by(id, full_name), sponsor:sponsor_id(id, full_name), " +
  "decider:decided_by(id, full_name), program:program_id(id, name), " +
  "project:project_id(id, name)";

const APPROVAL_SELECT =
  "id, note, due_at, decision, decision_note, decided_at, created_at, " +
  "requester:requested_by(id, full_name), approver:approver_id(id, full_name), " +
  "project_request:project_request_id(id, title), report:report_id(id, title), " +
  "opportunity:opportunity_id(id, title, crm_organization_id)";

export interface IntakeBoard {
  /** Still somebody's work, oldest first — a queue is worked from the front. */
  open: ProjectRequestRow[];
  settled: ProjectRequestRow[];
  /** Approvals addressed to the signed-in person and still unanswered. */
  waitingOnMe: ApprovalRow[];
  /** Approvals this person asked for and has not heard back on. */
  waitingOnOthers: ApprovalRow[];
}

/**
 * One round trip per table. The split into open and settled happens here
 * rather than in two queries because the queue is small and a second request
 * would cost more than the filter does.
 */
export async function getIntakeBoard(userId: string): Promise<IntakeBoard> {
  const supabase = await createSupabaseServerClient();

  const [{ data: requests }, { data: approvals }] = await Promise.all([
    supabase
      .from("project_request")
      .select(REQUEST_SELECT)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("approval_request")
      .select(APPROVAL_SELECT)
      .eq("decision", "pending")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(100),
  ]);

  const requestRows = (requests ?? []) as unknown as ProjectRequestRow[];
  const approvalRows = (approvals ?? []) as unknown as ApprovalRow[];

  return {
    open: requestRows.filter((row) => isOpenRequest(row.status)),
    // Newest decision first: the settled list is read as history.
    settled: requestRows
      .filter((row) => !isOpenRequest(row.status))
      .reverse(),
    waitingOnMe: approvalRows.filter((row) => row.approver?.id === userId),
    waitingOnOthers: approvalRows.filter(
      (row) => row.requester?.id === userId && row.approver?.id !== userId,
    ),
  };
}

/** The requests one person raised, for their own view of intake. */
export async function getMyRequests(userId: string): Promise<ProjectRequestRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("project_request")
    .select(REQUEST_SELECT)
    .eq("requested_by", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as unknown as ProjectRequestRow[];
}
