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
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.approvals.rules.metaTitle") };
}
export const dynamic = "force-dynamic";

/**
 * Admin → Approvals (#143). Every active rule that matches an item adds an
 * approver at its step; all approvers at a step must approve before the next
 * step opens. When no rule matches, any owner or administrator decides.
 */
export default async function AdminApprovalsPage() {
  await requireAdminAal2();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
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
    .map((row) => ({ value: row.user_id, label: row.user_profile?.full_name ?? t("finance.approvals.rules.unnamed") }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow={t("finance.approvals.rules.eyebrow")}
        title={t("finance.approvals.rules.title")}
        description={t("finance.approvals.rules.description")}
        actions={
          <EntityFormDialog
            triggerLabel={t("finance.approvals.rules.addRule")}
            title={t("finance.approvals.rules.addRuleTitle")}
            submitLabel={t("finance.approvals.rules.saveRule")}
            action={createApprovalRule}
            fields={[
              {
                name: "label",
                label: t("finance.approvals.rules.fieldLabel"),
                type: "text",
                required: true,
                placeholder: t("finance.approvals.rules.fieldLabelPlaceholder"),
              },
              {
                name: "approverKind",
                label: t("finance.approvals.rules.fieldKind"),
                type: "select",
                required: true,
                colSpan: 1,
                options: APPROVER_KINDS.map((value) => ({
                  value,
                  label: t(APPROVER_KIND_LABELS[value]),
                })),
              },
              {
                name: "approverUserId",
                label: t("finance.approvals.rules.fieldPerson"),
                type: "select",
                colSpan: 1,
                options: people,
                hint: t("finance.approvals.rules.fieldPersonHint"),
              },
              {
                name: "subjectType",
                label: t("finance.approvals.rules.fieldSubject"),
                type: "select",
                colSpan: 1,
                options: SUBJECT_TYPES.map((value) => ({
                  value,
                  label: t(SUBJECT_TYPE_LABELS[value]),
                })),
                hint: t("finance.approvals.rules.fieldSubjectHint"),
              },
              {
                name: "programId",
                label: t("finance.approvals.rules.fieldProgram"),
                type: "select",
                colSpan: 1,
                options: programOptions,
                hint: t("finance.approvals.rules.fieldProgramHint"),
              },
              {
                name: "minAmount",
                label: t("finance.approvals.rules.fieldMin"),
                type: "text",
                colSpan: 1,
                placeholder: "0.00",
              },
              {
                name: "maxAmount",
                label: t("finance.approvals.rules.fieldMax"),
                type: "text",
                colSpan: 1,
                hint: t("finance.approvals.rules.fieldMaxHint"),
              },
              {
                name: "step",
                label: t("finance.approvals.rules.fieldStep"),
                type: "select",
                colSpan: 1,
                defaultValue: "1",
                options: [1, 2, 3, 4, 5].map((n) => ({
                  value: String(n),
                  label: t("finance.approvals.rules.stepOption", { step: n }),
                })),
                hint: t("finance.approvals.rules.fieldStepHint"),
              },
            ]}
          />
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={<Route />}
          title={t("finance.approvals.rules.emptyTitle")}
          description={t("finance.approvals.rules.emptyDescription")}
        />
      ) : (
        <ul className="space-y-2" aria-label={t("finance.approvals.rules.listLabel")}>
          {rules.map((rule) => (
            <li key={rule.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  {t("finance.approvals.rules.ruleStep", { step: rule.step, label: rule.label })}
                  {rule.approver ? ` (${rule.approver.full_name})` : ""}
                </p>
                <p className="meta">
                  {rule.subject_type
                    ? t(SUBJECT_TYPE_LABELS[rule.subject_type])
                    : t("finance.approvals.rules.everyKind")}
                  {" · "}
                  {rule.program?.name ?? t("finance.approvals.rules.everyProgram")}
                  {" · "}
                  {describeRange(rule.min_amount_cents, rule.max_amount_cents, locale)}
                  {" · "}
                  {t(APPROVER_KIND_LABELS[rule.approver_kind])}
                </p>
              </div>
              {rule.active ? (
                <Badge tone="success">{t("finance.approvals.rules.on")}</Badge>
              ) : (
                <Badge tone="neutral">{t("finance.approvals.rules.off")}</Badge>
              )}
              <RuleControls ruleId={rule.id} active={rule.active} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
