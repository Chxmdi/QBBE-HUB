import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck, UserRoundCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { LinkTabs } from "@/components/shared/link-tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ApprovalActions,
  EndDelegationButton,
} from "@/features/approvals/components/approval-controls";
import {
  EVENT_LABELS,
  STATUS_LABELS,
  STATUS_TONE,
  SUBJECT_TYPES,
  SUBJECT_TYPE_LABELS,
  formatAmount,
} from "@/features/approvals/schemas";
import {
  setApprovalDelegation,
  submitApproval,
} from "@/features/approvals/services/approval.commands";
import {
  getApprovalDelegations,
  getApprovalDetail,
  getApprovalInbox,
  getMyApprovalRequests,
  getVisibleApprovals,
} from "@/features/approvals/services/approval.queries";
import type {
  ApprovalDelegationRow,
  ApprovalItemRow,
} from "@/features/approvals/services/approval.queries";
import { requireStaff } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getLocale, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.approvals.title") };
}
export const dynamic = "force-dynamic";

const STEP_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const;

/** Where the record behind an approval lives, for kinds that have a page. */
const SUBJECT_LINK: Partial<
  Record<ApprovalItemRow["subject_type"], { href: (id: string) => string; label: MessageKey }>
> = {
  bill: { href: (id) => `/finance/payables/bills/${id}`, label: "finance.approvals.detail.openBill" },
};

const STEP_STATUS_LABELS: Record<keyof typeof STEP_TONE, MessageKey> = {
  pending: "finance.approvals.detail.stepStatuses.pending",
  approved: "finance.approvals.detail.stepStatuses.approved",
  rejected: "finance.approvals.detail.stepStatuses.rejected",
  cancelled: "finance.approvals.detail.stepStatuses.cancelled",
};

interface I18n {
  t: TranslateFn;
  locale: Locale;
  format: Formatters;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Approvals (#143): the decisions waiting on you, the requests you made, and
 * for owners and admins everything in the organization. Who may decide is
 * settled in the database; this page only shows the buttons that will work.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; item?: string }>;
}) {
  const session = await requireStaff();
  const params = await searchParams;
  const tab =
    params.tab === "mine" || params.tab === "away" || (params.tab === "all" && session.isAdmin)
      ? params.tab
      : "inbox";
  const itemId = params.item && UUID.test(params.item) ? params.item : null;

  const [t, locale, format] = await Promise.all([getT(), getLocale(), getFormatters()]);
  const i18n: I18n = { t, locale, format };
  const supabase = await createSupabasePageClient();
  const [inbox, mine, all, detail, { data: programRows }, delegations, { data: memberRows }] =
    await Promise.all([
      getApprovalInbox(),
      getMyApprovalRequests(session.userId),
      tab === "all" ? getVisibleApprovals(null) : Promise.resolve([]),
      itemId ? getApprovalDetail(itemId) : Promise.resolve(null),
      supabase.from("program").select("id, name").eq("status", "active").order("name"),
      tab === "away" ? getApprovalDelegations() : Promise.resolve([]),
      tab === "away"
        ? supabase
            .from("organization_membership")
            .select("user_id, user_profile:user_id(full_name)")
            .eq("status", "active")
            .in("role", ["owner", "admin", "staff"])
        : Promise.resolve({ data: [] }),
    ]);
  const people = ((memberRows ?? []) as unknown as {
    user_id: string;
    user_profile: { full_name: string } | null;
  }[])
    .map((row) => ({ value: row.user_id, label: row.user_profile?.full_name ?? t("finance.approvals.rules.unnamed") }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rows = tab === "inbox" ? inbox : tab === "mine" ? mine : all;
  const programOptions = (programRows ?? []).map((row) => ({
    value: row.id as string,
    label: row.name as string,
  }));

  const hrefFor = (id: string) => `/approvals?tab=${tab}&item=${id}`;

  return (
    <div>
      <PageHeader
        eyebrow={t("finance.approvals.page.eyebrow")}
        title={t("finance.approvals.title")}
        description={t("finance.approvals.page.description")}
        actions={
          <EntityFormDialog
            triggerLabel={t("finance.approvals.page.requestApproval")}
            title={t("finance.approvals.page.requestApproval")}
            submitLabel={t("finance.approvals.page.submitForApproval")}
            action={submitApproval}
            fields={[
              {
                name: "subjectType",
                label: t("finance.approvals.page.fieldSubject"),
                type: "select",
                required: true,
                colSpan: 1,
                options: SUBJECT_TYPES.map((value) => ({
                  value,
                  label: t(SUBJECT_TYPE_LABELS[value]),
                })),
              },
              {
                name: "amount",
                label: t("finance.approvals.page.fieldAmount"),
                type: "text",
                colSpan: 1,
                placeholder: "0.00",
                hint: t("finance.approvals.page.fieldAmountHint"),
              },
              { name: "title", label: t("finance.approvals.page.fieldTitle"), type: "text", required: true },
              {
                name: "programId",
                label: t("finance.approvals.page.fieldProgram"),
                type: "select",
                options: programOptions,
                hint: t("finance.approvals.page.fieldProgramHint"),
              },
              { name: "description", label: t("finance.approvals.page.fieldDetails"), type: "textarea" },
            ]}
          />
        }
      />

      {detail ? (
        <ApprovalDetail
          detail={detail}
          userId={session.userId}
          isAdmin={session.isAdmin}
          closeHref={`/approvals?tab=${tab}`}
          i18n={i18n}
        />
      ) : itemId ? (
        <p className="card mb-5 px-4 py-3 text-[13.5px] text-muted">
          {t("finance.approvals.page.notAvailable")}
        </p>
      ) : null}

      <LinkTabs
        active={tab}
        tabs={[
          {
            id: "inbox",
            label: t("finance.approvals.page.tabInbox"),
            href: "/approvals?tab=inbox",
            count: inbox.length,
          },
          {
            id: "mine",
            label: t("finance.approvals.page.tabMine"),
            href: "/approvals?tab=mine",
            count: mine.length,
          },
          ...(session.isAdmin
            ? [{ id: "all", label: t("finance.approvals.page.tabAll"), href: "/approvals?tab=all" }]
            : []),
          { id: "away", label: t("finance.approvals.away.tab"), href: "/approvals?tab=away" },
        ]}
      />

      {tab === "away" ? (
        <AwayCover
          delegations={delegations}
          people={people}
          userId={session.userId}
          isAdmin={session.isAdmin}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CheckCheck />}
          title={
            tab === "inbox"
              ? t("finance.approvals.page.emptyInboxTitle")
              : t("finance.approvals.page.emptyMineTitle")
          }
          description={
            tab === "inbox"
              ? t("finance.approvals.page.emptyInboxDescription")
              : t("finance.approvals.page.emptyMineDescription")
          }
        />
      ) : (
        <ul className="space-y-2" aria-label={t("finance.approvals.page.listLabel")}>
          {rows.map((row) => (
            <ItemRow
              key={row.id}
              row={row}
              href={hrefFor(row.id)}
              selected={row.id === itemId}
              i18n={i18n}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemRow({
  row,
  href,
  selected,
  i18n: { t, locale, format },
}: {
  row: ApprovalItemRow;
  href: string;
  selected: boolean;
  i18n: I18n;
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "card flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-soft",
          selected && "ring-1 ring-brand/40",
        )}
      >
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{row.title}</span>
        <span className="text-[13.5px] tabular-nums">{formatAmount(row.amount_cents, locale)}</span>
        <Badge tone={STATUS_TONE[row.status]}>{t(STATUS_LABELS[row.status])}</Badge>
        <span className="meta w-full">
          {t(SUBJECT_TYPE_LABELS[row.subject_type])}
          {row.program ? ` · ${row.program.name}` : ""}
          {" · "}
          {row.requester?.full_name ?? t("finance.approvals.page.someone")}, {format.date(row.created_at)}
        </span>
      </Link>
    </li>
  );
}

function ApprovalDetail({
  detail,
  userId,
  isAdmin,
  closeHref,
  i18n: { t, locale, format },
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getApprovalDetail>>>;
  userId: string;
  isAdmin: boolean;
  closeHref: string;
  i18n: I18n;
}) {
  const { item, steps, events, inInbox } = detail;
  const pending = item.status === "pending";
  const own = item.requested_by === userId;
  // An owner or admin may cover for an absent approver; the database still
  // refuses their own request and a second step on the same item.
  const canDecide = pending && !own && (inInbox || isAdmin);
  const subjectLink = SUBJECT_LINK[item.subject_type];

  return (
    <section aria-label={t("finance.approvals.detail.label")} className="card mb-6 px-4 py-4">
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[16px] font-semibold">{item.title}</h2>
        <Badge tone={STATUS_TONE[item.status]}>{t(STATUS_LABELS[item.status])}</Badge>
        <Link href={closeHref} className="text-[13px] text-muted hover:text-ink">
          {t("finance.approvals.detail.close")}
        </Link>
      </div>
      <p className="meta mt-1">
        {t(SUBJECT_TYPE_LABELS[item.subject_type])} · {formatAmount(item.amount_cents, locale)}
        {item.program ? ` · ${item.program.name}` : ""} ·{" "}
        {t("finance.approvals.detail.requestedBy", {
          name: item.requester?.full_name ?? t("finance.approvals.detail.someone"),
          date: format.date(item.created_at),
        })}
      </p>
      {subjectLink && item.subject_id ? (
        <p className="mt-2 text-[13.5px]">
          <Link href={subjectLink.href(item.subject_id)} className="text-brand-fg underline">
            {t(subjectLink.label)}
          </Link>{" "}
          <span className="meta">{t("finance.approvals.detail.seeLines")}</span>
        </p>
      ) : null}
      {item.description ? (
        <p className="mt-2 text-[13.5px] whitespace-pre-wrap">{item.description}</p>
      ) : null}
      {item.decision_note && !pending ? (
        <p className="mt-2 text-[13.5px]">
          <span className="font-medium">{t("finance.approvals.detail.decisionNote")}</span>{" "}
          {item.decision_note}
        </p>
      ) : null}

      <h3 className="mt-4 text-[13.5px] font-semibold">{t("finance.approvals.detail.approvers")}</h3>
      <ol className="mt-1 space-y-1" aria-label={t("finance.approvals.detail.approvers")}>
        {steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
            <span className="meta">{t("finance.approvals.detail.step", { step: step.step })}</span>
            <span>
              {step.label}
              {step.approver
                ? ` (${step.approver.full_name})`
                : t("finance.approvals.detail.anyAdmin")}
            </span>
            <Badge tone={STEP_TONE[step.status]}>
              {step.status === "pending" && step.step !== item.current_step
                ? t("finance.approvals.detail.later")
                : t(STEP_STATUS_LABELS[step.status])}
            </Badge>
            {step.decider && step.decided_at ? (
              <span className="meta">
                {step.on_behalf
                  ? t("finance.approvals.detail.decidedByOnBehalf", {
                      name: step.decider.full_name,
                      onBehalf: step.on_behalf.full_name,
                      date: format.dateTime(step.decided_at),
                    })
                  : t("finance.approvals.detail.decidedBy", {
                      name: step.decider.full_name,
                      date: format.dateTime(step.decided_at),
                    })}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <h3 className="mt-4 text-[13.5px] font-semibold">{t("finance.approvals.detail.trail")}</h3>
      <ol className="mt-1 space-y-1.5" aria-label={t("finance.approvals.detail.trailLabel")}>
        {events.map((event) => (
          <li key={event.id} className="text-[13.5px]">
            <span className="font-medium">
              {EVENT_LABELS[event.kind] ? t(EVENT_LABELS[event.kind]) : event.kind}
            </span>{" "}
            {event.on_behalf
              ? t("finance.approvals.detail.byOnBehalf", {
                  name: event.actor?.full_name ?? t("finance.approvals.detail.someone"),
                  onBehalf: event.on_behalf.full_name,
                })
              : t("finance.approvals.detail.by", {
                  name: event.actor?.full_name ?? t("finance.approvals.detail.someone"),
                })}
            <span className="meta"> · {format.dateTime(event.created_at)}</span>
            {event.note ? <p className="text-muted whitespace-pre-wrap">{event.note}</p> : null}
          </li>
        ))}
      </ol>

      {pending ? (
        <ApprovalActions itemId={item.id} canDecide={canDecide} canWithdraw={own} />
      ) : null}
    </section>
  );
}

/**
 * Away cover: while an approver is away, the delegate they name decides the
 * steps waiting on them, and the trail says on whose behalf. The database
 * decides who may set one, refuses chains and overlaps, and ends each at the
 * end of its last day.
 */
async function AwayCover({
  delegations,
  people,
  userId,
  isAdmin,
}: {
  delegations: ApprovalDelegationRow[];
  people: { value: string; label: string }[];
  userId: string;
  isAdmin: boolean;
}) {
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  return (
    <section aria-label={t("finance.approvals.away.tab")}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="meta min-w-0 flex-1">
          {t("finance.approvals.away.intro")}
        </p>
        <EntityFormDialog
          triggerLabel={t("finance.approvals.away.setDelegate")}
          triggerVariant="secondary"
          title={t("finance.approvals.away.dialogTitle")}
          submitLabel={t("finance.approvals.away.saveDelegate")}
          action={setApprovalDelegation}
          fields={[
            ...(isAdmin
              ? [
                  {
                    name: "approverId",
                    label: t("finance.approvals.away.approverAway"),
                    type: "select" as const,
                    options: people,
                    hint: t("finance.approvals.away.approverAwayHint"),
                  },
                ]
              : []),
            {
              name: "delegateId",
              label: t("finance.approvals.away.delegate"),
              type: "select",
              required: true,
              options: people.filter((person) => isAdmin || person.value !== userId),
            },
            { name: "startsOn", label: t("finance.approvals.away.firstDay"), type: "date", required: true, colSpan: 1 },
            { name: "endsOn", label: t("finance.approvals.away.lastDay"), type: "date", required: true, colSpan: 1 },
            {
              name: "note",
              label: t("finance.approvals.away.note"),
              type: "text",
              placeholder: t("finance.approvals.away.notePlaceholder"),
            },
          ]}
        />
      </div>
      {delegations.length === 0 ? (
        <EmptyState
          icon={<UserRoundCheck />}
          title={t("finance.approvals.away.emptyTitle")}
          description={t("finance.approvals.away.emptyDescription")}
        />
      ) : (
        <ul className="space-y-2" aria-label={t("finance.approvals.away.listLabel")}>
          {delegations.map((row) => {
            const started = row.active;
            const canEnd = row.approver_id === userId || isAdmin;
            return (
              <li key={row.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">
                    {t("finance.approvals.away.decidesFor", {
                      delegate: row.delegate?.full_name ?? t("finance.approvals.away.someoneCapital"),
                      approver: row.approver?.full_name ?? t("finance.approvals.away.someone"),
                    })}
                  </p>
                  <p className="meta">
                    {/* Calendar dates, not instants: read them in UTC so they do not shift a day. */}
                    {t("finance.approvals.away.range", {
                      from: format.date(row.starts_on, "UTC"),
                      to: format.date(row.ends_on, "UTC"),
                    })}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <Badge tone={started ? "success" : "neutral"}>{started ? t("finance.approvals.away.active") : t("finance.approvals.away.upcoming")}</Badge>
                {canEnd ? (
                  <EndDelegationButton delegationId={row.id} label={started ? t("finance.approvals.away.endNow") : t("finance.approvals.away.cancel")} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
