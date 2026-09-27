import type { Metadata } from "next";
import { Route } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { RuleControls } from "@/features/approvals/components/approval-controls";
import {
  APPROVER_KINDS,
  APPROVER_KIND_LABELS,
  SUBJECT_TYPES,
  SUBJECT_TYPE_LABELS,
  describeRange,
} from "@/features/approvals/schemas";
import { createApprovalRule } from "@/features/approvals/services/approval.commands";
import { getApprovalRules } from "@/features/approvals/services/approval.queries";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const metadata: Metadata = { title: "Approval rules" };
export const dynamic = "force-dynamic";

/**
 * Admin → Approvals (#143). Every active rule that matches an item adds an
 * approver at its step; all approvers at a step must approve before the next
 * step opens. When no rule matches, any owner or administrator decides.
 */
export default async function AdminApprovalsPage() {
  await requireAdminAal2();
  const supabase = await createSupabasePageClient();
  const [rules, { data: programRows }, { data: memberRows }] = await Promise.all([
    getApprovalRules(),
    supabase.from("program").select("id, name").eq("status", "active").order("name"),
    supabase
      .from("organization_membership")
      .select("user_id, user_profile:user_id(full_name)")
      .eq("status", "active")
      .in("role", ["owner", "admin", "staff"]),
  ]);

  const programOptions = (programRows ?? []).map((row) => ({
    value: row.id as string,
    label: row.name as string,
  }));
  const people = ((memberRows ?? []) as unknown as {
    user_id: string;
    user_profile: { full_name: string } | null;
  }[])
    .map((row) => ({ value: row.user_id, label: row.user_profile?.full_name ?? "Unnamed" }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow="Administration"
        title="Approval rules"
        description="Who approves what, by kind of item, program and amount. Changes apply to new requests; items already waiting keep their approvers."
        actions={
          <EntityFormDialog
            triggerLabel="Add rule"
            title="Add an approval rule"
            submitLabel="Save rule"
            action={createApprovalRule}
            fields={[
              {
                name: "label",
                label: "Approver title",
                type: "text",
                required: true,
                placeholder: "Executive director",
              },
              {
                name: "approverKind",
                label: "Who approves",
                type: "select",
                required: true,
                colSpan: 1,
                options: APPROVER_KINDS.map((value) => ({
                  value,
                  label: APPROVER_KIND_LABELS[value],
                })),
              },
              {
                name: "approverUserId",
                label: "Person",
                type: "select",
                colSpan: 1,
                options: people,
                hint: "Only when a named person approves.",
              },
              {
                name: "subjectType",
                label: "Applies to",
                type: "select",
                colSpan: 1,
                options: SUBJECT_TYPES.map((value) => ({
                  value,
                  label: SUBJECT_TYPE_LABELS[value],
                })),
                hint: "Leave empty for every kind.",
              },
              {
                name: "programId",
                label: "Program",
                type: "select",
                colSpan: 1,
                options: programOptions,
                hint: "Leave empty for every program.",
              },
              {
                name: "minAmount",
                label: "From amount (CAD)",
                type: "text",
                colSpan: 1,
                placeholder: "0.00",
              },
              {
                name: "maxAmount",
                label: "Up to, not including (CAD)",
                type: "text",
                colSpan: 1,
                hint: "Leave empty for no upper limit.",
              },
              {
                name: "step",
                label: "Step",
                type: "select",
                colSpan: 1,
                defaultValue: "1",
                options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Step ${n}` })),
                hint: "Step 2 approvers are asked after every step 1 approver has approved.",
              },
            ]}
          />
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={<Route />}
          title="No approval rules yet"
          description="Until you add rules, every request goes to the owners and administrators."
        />
      ) : (
        <ul className="space-y-2" aria-label="Approval rules">
          {rules.map((rule) => (
            <li key={rule.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  Step {rule.step}: {rule.label}
                  {rule.approver ? ` (${rule.approver.full_name})` : ""}
                </p>
                <p className="meta">
                  {rule.subject_type ? SUBJECT_TYPE_LABELS[rule.subject_type] : "Every kind"}
                  {" · "}
                  {rule.program?.name ?? "Every program"}
                  {" · "}
                  {describeRange(rule.min_amount_cents, rule.max_amount_cents)}
                  {" · "}
                  {APPROVER_KIND_LABELS[rule.approver_kind]}
                </p>
              </div>
              {rule.active ? (
                <Badge tone="success">On</Badge>
              ) : (
                <Badge tone="neutral">Off</Badge>
              )}
              <RuleControls ruleId={rule.id} active={rule.active} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
