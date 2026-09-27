import { createSupabasePageClient } from "@/lib/supabase/page";
import type { ApprovalStatus, ApproverKind, SubjectType } from "@/features/approvals/schemas";

/**
 * Approval reads (#143). Row-level security decides what each person sees:
 * their own requests, items where they are named on a step, and (for owners
 * and admins with MFA) everything in their organization.
 */

export interface ApprovalItemRow {
  id: string;
  subject_type: SubjectType;
  subject_id: string | null;
  title: string;
  description: string | null;
  amount_cents: number | null;
  status: ApprovalStatus;
  current_step: number | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  requested_by: string;
  requester: { full_name: string } | null;
  program: { name: string } | null;
}

export interface ApprovalStepRow {
  id: string;
  step: number;
  label: string;
  approver_kind: Exclude<ApproverKind, "program_lead">;
  approver_id: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_at: string | null;
  note: string | null;
  approver: { full_name: string } | null;
  decider: { full_name: string } | null;
}

export interface ApprovalEventRow {
  id: string;
  kind: string;
  step: number | null;
  note: string | null;
  created_at: string;
  actor: { full_name: string } | null;
}

export interface ApprovalRuleRow {
  id: string;
  label: string;
  step: number;
  subject_type: SubjectType | null;
  min_amount_cents: number;
  max_amount_cents: number | null;
  approver_kind: ApproverKind;
  active: boolean;
  program: { name: string } | null;
  approver: { full_name: string } | null;
}

const ITEM_COLUMNS =
  "id, subject_type, subject_id, title, description, amount_cents, status, current_step, decision_note, decided_at, created_at, requested_by, requester:user_profile!approval_item_requested_by_fkey(full_name), program:program_id(name)";

type PageClient = Awaited<ReturnType<typeof createSupabasePageClient>>;

async function itemsByIds(supabase: PageClient, ids: string[]): Promise<ApprovalItemRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("approval_item")
    .select(ITEM_COLUMNS)
    .in("id", ids)
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as ApprovalItemRow[];
}

/** Items the signed-in person can decide right now. */
export async function getApprovalInbox(): Promise<ApprovalItemRow[]> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase.rpc("approval_inbox").select("id").throwOnError();
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  return itemsByIds(supabase, ids);
}

export async function getMyApprovalRequests(userId: string): Promise<ApprovalItemRow[]> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("approval_item")
    .select(ITEM_COLUMNS)
    .eq("requested_by", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as unknown as ApprovalItemRow[];
}

/** Everything the reader may see; for owners and admins, the whole organization. */
export async function getVisibleApprovals(status: ApprovalStatus | null): Promise<ApprovalItemRow[]> {
  const supabase = await createSupabasePageClient();
  let query = supabase.from("approval_item").select(ITEM_COLUMNS);
  if (status) query = query.eq("status", status);
  const { data } = await query.order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as unknown as ApprovalItemRow[];
}

export async function getApprovalDetail(itemId: string): Promise<{
  item: ApprovalItemRow;
  steps: ApprovalStepRow[];
  events: ApprovalEventRow[];
  inInbox: boolean;
} | null> {
  const supabase = await createSupabasePageClient();
  const [{ data: item }, { data: steps }, { data: events }, { data: inbox }] = await Promise.all([
    supabase.from("approval_item").select(ITEM_COLUMNS).eq("id", itemId).maybeSingle(),
    supabase
      .from("approval_step")
      .select(
        "id, step, label, approver_kind, approver_id, status, decided_at, note, approver:user_profile!approval_step_approver_id_fkey(full_name), decider:user_profile!approval_step_decided_by_fkey(full_name)",
      )
      .eq("item_id", itemId)
      .order("step")
      .order("created_at"),
    supabase
      .from("approval_event")
      .select("id, kind, step, note, created_at, actor:actor_id(full_name)")
      .eq("item_id", itemId)
      .order("created_at"),
    supabase.rpc("approval_inbox").select("id").eq("id", itemId).throwOnError(),
  ]);
  if (!item) return null;
  return {
    item: item as unknown as ApprovalItemRow,
    steps: (steps ?? []) as unknown as ApprovalStepRow[],
    events: (events ?? []) as unknown as ApprovalEventRow[],
    inInbox: ((inbox ?? []) as unknown[]).length > 0,
  };
}

export async function getApprovalRules(): Promise<ApprovalRuleRow[]> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("approval_rule")
    .select(
      "id, label, step, subject_type, min_amount_cents, max_amount_cents, approver_kind, active, program:program_id(name), approver:user_profile!approval_rule_approver_user_id_fkey(full_name)",
    )
    .order("step")
    .order("min_amount_cents")
    .order("created_at");
  return (data ?? []) as unknown as ApprovalRuleRow[];
}
