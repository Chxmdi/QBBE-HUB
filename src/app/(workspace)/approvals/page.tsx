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
import { cn, formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

const STEP_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const;

/** Where the record behind an approval lives, for kinds that have a page. */
const SUBJECT_LINK: Partial<Record<ApprovalItemRow["subject_type"], (id: string) => string>> = {
  bill: (id) => `/finance/payables/bills/${id}`,
};

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
    .map((row) => ({ value: row.user_id, label: row.user_profile?.full_name ?? "Unnamed" }))
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
        eyebrow="Finance"
        title="Approvals"
        description="Purchases, expense claims, bills and contracts, routed to the right approvers by amount and program."
        actions={
          <EntityFormDialog
            triggerLabel="Request approval"
            title="Request approval"
            submitLabel="Submit for approval"
            action={submitApproval}
            fields={[
              {
                name: "subjectType",
                label: "What needs approval",
                type: "select",
                required: true,
                colSpan: 1,
                options: SUBJECT_TYPES.map((value) => ({
                  value,
                  label: SUBJECT_TYPE_LABELS[value],
                })),
              },
              {
                name: "amount",
                label: "Amount (CAD, taxes included)",
                type: "text",
                colSpan: 1,
                placeholder: "0.00",
                hint: "Required for purchases, expense claims, bills and payments.",
              },
              { name: "title", label: "Title", type: "text", required: true },
              {
                name: "programId",
                label: "Program",
                type: "select",
                options: programOptions,
                hint: "Items in a program go to its lead when the rules say so.",
              },
              { name: "description", label: "Details", type: "textarea" },
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
        />
      ) : itemId ? (
        <p className="card mb-5 px-4 py-3 text-[13.5px] text-muted">
          That approval is not available to you.
        </p>
      ) : null}

      <LinkTabs
        active={tab}
        tabs={[
          { id: "inbox", label: "Waiting on me", href: "/approvals?tab=inbox", count: inbox.length },
          { id: "mine", label: "My requests", href: "/approvals?tab=mine", count: mine.length },
          ...(session.isAdmin
            ? [{ id: "all", label: "All", href: "/approvals?tab=all" }]
            : []),
          { id: "away", label: "Away cover", href: "/approvals?tab=away" },
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
          title={tab === "inbox" ? "Nothing waiting on you" : "No requests yet"}
          description={
            tab === "inbox"
              ? "When something needs your approval it appears here, and you get a notification."
              : "Use Request approval to send a purchase, expense claim, bill or contract to its approvers."
          }
        />
      ) : (
        <ul className="space-y-2" aria-label="Approvals">
          {rows.map((row) => (
            <ItemRow key={row.id} row={row} href={hrefFor(row.id)} selected={row.id === itemId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemRow({ row, href, selected }: { row: ApprovalItemRow; href: string; selected: boolean }) {
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
        <span className="text-[13.5px] tabular-nums">{formatAmount(row.amount_cents)}</span>
        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
        <span className="meta w-full">
          {SUBJECT_TYPE_LABELS[row.subject_type]}
          {row.program ? ` · ${row.program.name}` : ""}
          {" · "}
          {row.requester?.full_name ?? "Someone"}, {formatDate(row.created_at)}
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
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getApprovalDetail>>>;
  userId: string;
  isAdmin: boolean;
  closeHref: string;
}) {
  const { item, steps, events, inInbox } = detail;
  const pending = item.status === "pending";
  const own = item.requested_by === userId;
  // An owner or admin may cover for an absent approver; the database still
  // refuses their own request and a second step on the same item.
  const canDecide = pending && !own && (inInbox || isAdmin);

  return (
    <section aria-label="Approval details" className="card mb-6 px-4 py-4">
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[16px] font-semibold">{item.title}</h2>
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</Badge>
        <Link href={closeHref} className="text-[13px] text-muted hover:text-ink">
          Close
        </Link>
      </div>
      <p className="meta mt-1">
        {SUBJECT_TYPE_LABELS[item.subject_type]} · {formatAmount(item.amount_cents)}
        {item.program ? ` · ${item.program.name}` : ""} · requested by{" "}
        {item.requester?.full_name ?? "someone"} on {formatDate(item.created_at)}
      </p>
      {SUBJECT_LINK[item.subject_type] && item.subject_id ? (
        <p className="mt-2 text-[13.5px]">
          <Link href={SUBJECT_LINK[item.subject_type]!(item.subject_id)} className="text-brand-fg underline">
            Open the {SUBJECT_TYPE_LABELS[item.subject_type].toLowerCase()}
          </Link>{" "}
          <span className="meta">to see its lines before you decide.</span>
        </p>
      ) : null}
      {item.description ? (
        <p className="mt-2 text-[13.5px] whitespace-pre-wrap">{item.description}</p>
      ) : null}
      {item.decision_note && !pending ? (
        <p className="mt-2 text-[13.5px]">
          <span className="font-medium">Decision note:</span> {item.decision_note}
        </p>
      ) : null}

      <h3 className="mt-4 text-[13.5px] font-semibold">Approvers</h3>
      <ol className="mt-1 space-y-1" aria-label="Approvers">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
            <span className="meta">Step {step.step}</span>
            <span>
              {step.label}
              {step.approver ? ` (${step.approver.full_name})` : " (any owner or administrator)"}
            </span>
            <Badge tone={STEP_TONE[step.status]}>
              {step.status === "pending" && step.step !== item.current_step
                ? "Later"
                : step.status[0].toUpperCase() + step.status.slice(1)}
            </Badge>
            {step.decider && step.decided_at ? (
              <span className="meta">
                by {step.decider.full_name}
                {step.on_behalf ? ` on behalf of ${step.on_behalf.full_name}` : ""},{" "}
                {formatDateTime(step.decided_at)}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <h3 className="mt-4 text-[13.5px] font-semibold">Trail</h3>
      <ol className="mt-1 space-y-1.5" aria-label="Approval trail">
        {events.map((event) => (
          <li key={event.id} className="text-[13.5px]">
            <span className="font-medium">{EVENT_LABELS[event.kind] ?? event.kind}</span>
            {" by "}
            {event.actor?.full_name ?? "someone"}
            {event.on_behalf ? ` on behalf of ${event.on_behalf.full_name}` : ""}
            <span className="meta"> · {formatDateTime(event.created_at)}</span>
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
function AwayCover({
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
  return (
    <section aria-label="Away cover">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="meta min-w-0 flex-1">
          Going away? Name someone to decide the approvals waiting on you. They can never approve
          their own requests, and it ends by itself after the last day.
        </p>
        <EntityFormDialog
          triggerLabel="Set a delegate"
          triggerVariant="secondary"
          title="Set a delegate while away"
          submitLabel="Save delegate"
          action={setApprovalDelegation}
          fields={[
            ...(isAdmin
              ? [
                  {
                    name: "approverId",
                    label: "Approver who is away",
                    type: "select" as const,
                    options: people,
                    hint: "Leave empty for yourself. Setting it for someone else needs MFA.",
                  },
                ]
              : []),
            {
              name: "delegateId",
              label: "Delegate",
              type: "select",
              required: true,
              options: people.filter((person) => isAdmin || person.value !== userId),
            },
            { name: "startsOn", label: "First day", type: "date", required: true, colSpan: 1 },
            { name: "endsOn", label: "Last day", type: "date", required: true, colSpan: 1 },
            { name: "note", label: "Note", type: "text", placeholder: "Vacation" },
          ]}
        />
      </div>
      {delegations.length === 0 ? (
        <EmptyState
          icon={<UserRoundCheck />}
          title="No one is covering"
          description="Delegations you set, or that name you as the delegate, appear here."
        />
      ) : (
        <ul className="space-y-2" aria-label="Delegations">
          {delegations.map((row) => {
            const started = row.active;
            const canEnd = row.approver_id === userId || isAdmin;
            return (
              <li key={row.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">
                    {row.delegate?.full_name ?? "Someone"} decides for{" "}
                    {row.approver?.full_name ?? "someone"}
                  </p>
                  <p className="meta">
                    {/* Calendar dates, not instants: read them in UTC so they do not shift a day. */}
                    {formatDate(row.starts_on, "UTC")} to {formatDate(row.ends_on, "UTC")}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <Badge tone={started ? "success" : "neutral"}>{started ? "Active" : "Upcoming"}</Badge>
                {canEnd ? (
                  <EndDelegationButton delegationId={row.id} label={started ? "End now" : "Cancel"} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
