import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Inbox } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DeepLinkScroll } from "@/components/shared/deep-link-scroll";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ApprovalDecision,
  RequestClarification,
  RequestDecision,
} from "@/features/requests/components/request-controls";
import {
  REQUEST_STATUS_KEYS,
  daysWaiting,
  requestIsStale,
} from "@/features/requests/schemas";
import { submitProjectRequest } from "@/features/requests/services/request.commands";
import { getIntakeBoard } from "@/features/requests/services/request.queries";
import type {
  ApprovalRow,
  ProjectRequestRow,
} from "@/features/requests/services/request.queries";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { cn } from "@/lib/utils";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("requests.title") };
}
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  submitted: "info",
  in_review: "warning",
  approved: "success",
  declined: "danger",
  withdrawn: "neutral",
  deferred: "warning",
  returned: "warning",
} as const;

const HIGHLIGHT = "bg-accent/15 ring-1 ring-brand/40";

/**
 * Intake, in one place.
 *
 * Everyone can propose work — that is what an intake queue is for, and a
 * charity that only lets staff suggest projects hears from a smaller world.
 * What each person sees is decided entirely by the policies: a volunteer's
 * queue contains their own requests, a staff member's contains everybody's.
 * There is no role branch in this file for that reason.
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; create?: string }>;
}) {
  const session = await requireSession();
  const { request: highlightId = null, create } = await searchParams;
  const now = new Date();
  const [t, format] = await Promise.all([getT(), getFormatters()]);

  const supabase = await createSupabasePageClient();
  const [board, options, { data: programRows }] = await Promise.all([
    getIntakeBoard(session.userId),
    getPickerOptions(),
    supabase.from("program").select("id, name").eq("status", "active").order("name"),
  ]);

  const programOptions = (programRows ?? []).map((row) => ({
    value: row.id as string,
    label: row.name as string,
  }));

  return (
    <div>
      <PageHeader
        eyebrow={t("requests.eyebrow")}
        title={t("requests.heading")}
        description={t("requests.description")}
        actions={
          <EntityFormDialog
            triggerLabel={t("requests.propose")}
            title={t("requests.proposeTitle")}
            // Quick create and the command palette land here (P0-QC-01).
            defaultOpen={create === "1"}
            submitLabel={t("requests.submitRequest")}
            action={submitProjectRequest}
            fields={[
              { name: "title", label: t("requests.fields.title"), type: "text", required: true },
              {
                name: "summary",
                label: t("requests.fields.summary"),
                type: "textarea",
                required: true,
              },
              { name: "rationale", label: t("requests.fields.rationale"), type: "textarea" },
              {
                name: "beneficiaries",
                label: t("requests.fields.beneficiaries"),
                type: "textarea",
                hint: t("requests.fields.beneficiariesHint"),
              },
              {
                name: "programId",
                label: t("requests.fields.program"),
                type: "select",
                colSpan: 1,
                options: programOptions,
              },
              {
                name: "sponsorId",
                label: t("requests.fields.sponsor"),
                type: "select",
                colSpan: 1,
                options: options.people.map((p) => ({ value: p.id, label: p.label })),
              },
              { name: "neededBy", label: t("requests.fields.neededBy"), type: "date", colSpan: 1 },
              {
                name: "estimatedEffort",
                label: t("requests.fields.effort"),
                type: "text",
                colSpan: 1,
                placeholder: t("requests.fields.effortPlaceholder"),
              },
            ]}
          />
        }
      />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="intake-queue">
          <h2 id="intake-queue" className="section-heading mb-3">
            {t("requests.openRequests")}
            <span className="ml-2 font-normal text-muted">{board.open.length}</span>
          </h2>

          {board.open.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck aria-hidden />}
              title={t("requests.emptyTitle")}
              description={t("requests.emptyDescription")}
            />
          ) : (
            <ul className="card divide-y divide-line">
              {board.open.map((request) => (
                <RequestItem
                  key={request.id}
                  request={request}
                  now={now}
                  viewerId={session.userId}
                  canDecide={session.isStaff}
                  highlighted={request.id === highlightId}
                  t={t}
                  format={format}
                />
              ))}
            </ul>
          )}

          {board.settled.length > 0 ? (
            <details
              className="card mt-3 px-4 py-3"
              open={board.settled.some((row) => row.id === highlightId)}
            >
              <summary className="cursor-pointer text-[13.5px] font-medium">
                {t("requests.decidedCount", { count: board.settled.length })}
              </summary>
              <ul className="mt-2 divide-y divide-line">
                {board.settled.map((request) => (
                  <li
                    key={request.id}
                    id={`request-${request.id}`}
                    className={cn("py-2.5", request.id === highlightId && HIGHLIGHT)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-[13.5px]">
                        {request.title}
                      </span>
                      <Badge tone={STATUS_TONE[request.status]}>
                        {t(REQUEST_STATUS_KEYS[request.status])}
                      </Badge>
                    </div>
                    <p className="meta mt-0.5">
                      {request.requester?.full_name ?? t("requests.someone")}
                      {request.decided_at
                        ? ` · ${
                            request.decider
                              ? t("requests.decidedOnBy", {
                                  date: format.date(request.decided_at),
                                  name: request.decider.full_name,
                                })
                              : t("requests.decidedOn", { date: format.date(request.decided_at) })
                          }`
                        : request.decider
                          ? ` ${t("requests.byName", { name: request.decider.full_name })}`
                          : ""}
                    </p>
                    {request.project ? (
                      <p className="mt-0.5 text-[13px]">
                        <Link
                          href={`/projects/${request.project.id}`}
                          className="font-medium text-brand-fg hover:underline"
                        >
                          {request.project.name}
                        </Link>
                        <span className="text-muted"> {t("requests.becameProject")}</span>
                      </p>
                    ) : null}
                    {request.decision_note ? (
                      <p className="mt-0.5 text-[13px] text-muted">
                        {request.decision_note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <aside className="space-y-8">
          <ApprovalList
            id="waiting-on-me"
            heading={t("requests.waitingOnYou")}
            empty={t("requests.nothingNeedsYou")}
            approvals={board.waitingOnMe}
            actionable
            t={t}
            format={format}
          />
          <ApprovalList
            id="waiting-on-others"
            heading={t("requests.youAskedFor")}
            empty=""
            approvals={board.waitingOnOthers}
            t={t}
            format={format}
          />
        </aside>
      </div>

      <DeepLinkScroll targetId={highlightId ? `request-${highlightId}` : null} />
    </div>
  );
}

function RequestItem({
  request,
  now,
  viewerId,
  canDecide,
  highlighted,
  t,
  format,
}: {
  request: ProjectRequestRow;
  now: Date;
  viewerId: string;
  canDecide: boolean;
  highlighted: boolean;
  t: TranslateFn;
  format: Formatters;
}) {
  const waiting = daysWaiting(request.created_at, now);
  const stale = requestIsStale(request, now);
  // A returned request is waiting on its author, not on the queue, so the
  // "nobody has answered this" warning would be accusing the wrong person.
  const handedBack = request.status === "returned" || request.status === "deferred";
  const mine = request.requester?.id === viewerId;

  return (
    <li
      id={`request-${request.id}`}
      className={cn("px-4 py-3", highlighted && HIGHLIGHT)}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">
          {request.title}
        </span>
        <Badge tone={STATUS_TONE[request.status]}>
          {t(REQUEST_STATUS_KEYS[request.status])}
        </Badge>
      </div>

      <p className="meta mt-0.5">
        {request.requester?.full_name ?? t("requests.someone")}
        {` · ${t(waiting === 1 ? "requests.waitingDayOne" : "requests.waitingDayOther", { count: waiting })}`}
        {request.sponsor
          ? ` · ${t("requests.sponsorName", { name: request.sponsor.full_name })}`
          : ` · ${t("requests.noSponsor")}`}
        {request.program ? ` · ${request.program.name}` : ""}
        {request.needed_by
          ? ` · ${t("requests.neededByDate", { date: format.date(request.needed_by) })}`
          : ""}
      </p>

      {stale && !handedBack ? (
        <p className="mt-1 text-[13px] text-warning-fg">
          {t("requests.stale", { count: waiting })}
        </p>
      ) : null}

      <p className="mt-1 text-[13px]">{request.summary}</p>
      {request.beneficiaries ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("requests.serves")} </span>
          {request.beneficiaries}
        </p>
      ) : null}

      {handedBack && request.decision_note ? (
        <p className="mt-1 rounded-md bg-warning/10 px-2.5 py-1.5 text-[13px]">
          <span className="font-medium">
            {t("requests.handedBackLabel", {
              label: [
                t(
                  request.status === "returned"
                    ? "requests.handedBack.returned"
                    : "requests.handedBack.deferred",
                ),
                request.decider ? t("requests.byName", { name: request.decider.full_name }) : "",
                request.decided_at
                  ? t("requests.onDate", { date: format.date(request.decided_at) })
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            })}{" "}
          </span>
          {request.decision_note}
        </p>
      ) : null}

      {mine && request.status === "returned" ? (
        <RequestClarification
          requestId={request.id}
          summary={request.summary}
          rationale={request.rationale}
          beneficiaries={request.beneficiaries}
          question={request.decision_note}
        />
      ) : null}

      {canDecide ? (
        <RequestDecision
          requestId={request.id}
          title={request.title}
          status={request.status}
        />
      ) : null}
    </li>
  );
}

function subjectOf(
  approval: ApprovalRow,
  t: TranslateFn,
): { label: string; href: string | null } {
  if (approval.project_request) {
    return {
      label: approval.project_request.title,
      href: `/requests?request=${approval.project_request.id}`,
    };
  }
  if (approval.report) {
    return { label: approval.report.title, href: `/reports/${approval.report.id}` };
  }
  if (approval.opportunity) {
    return {
      label: approval.opportunity.title,
      href: `/crm/${approval.opportunity.crm_organization_id}?opportunity=${approval.opportunity.id}`,
    };
  }
  // Unreachable while `exactly_one_subject` holds, but a missing label would
  // be a worse way to find that out than a visible one.
  return { label: t("requests.unknownRecord"), href: null };
}

function ApprovalList({
  id,
  heading,
  empty,
  approvals,
  actionable = false,
  t,
  format,
}: {
  id: string;
  heading: string;
  empty: string;
  approvals: ApprovalRow[];
  actionable?: boolean;
  t: TranslateFn;
  format: Formatters;
}) {
  if (approvals.length === 0 && !empty) return null;

  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="section-heading mb-3">
        {heading}
        {approvals.length > 0 ? (
          <span className="ml-2 font-normal text-muted">{approvals.length}</span>
        ) : null}
      </h2>
      {approvals.length === 0 ? (
        <EmptyState icon={<Inbox aria-hidden />} title={empty} />
      ) : (
        <ul className="card divide-y divide-line">
          {approvals.map((approval) => {
            const subject = subjectOf(approval, t);
            return (
              <li key={approval.id} id={`approval-${approval.id}`} className="px-4 py-3">
                {subject.href ? (
                  <Link
                    href={subject.href}
                    className="text-[13.5px] font-medium hover:text-brand-fg"
                  >
                    {subject.label}
                  </Link>
                ) : (
                  <span className="text-[13.5px] font-medium">{subject.label}</span>
                )}
                <p className="meta mt-0.5">
                  {actionable
                    ? t("requests.askedYou", {
                        name: approval.requester?.full_name ?? t("requests.someone"),
                      })
                    : t("requests.waitingOn", {
                        name: approval.approver?.full_name ?? t("requests.someoneLower"),
                      })}
                  {approval.due_at
                    ? ` · ${t("requests.dueBy", { date: format.date(approval.due_at) })}`
                    : ""}
                </p>
                {approval.note ? (
                  <p className="mt-1 text-[13px]">{approval.note}</p>
                ) : null}
                {actionable ? <ApprovalDecision approvalId={approval.id} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
