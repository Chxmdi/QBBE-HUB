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
  RequestDecision,
} from "@/features/requests/components/request-controls";
import {
  REQUEST_STATUS_LABELS,
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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  submitted: "info",
  in_review: "warning",
  approved: "success",
  declined: "danger",
  withdrawn: "neutral",
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
  searchParams: Promise<{ request?: string }>;
}) {
  const session = await requireSession();
  const { request: highlightId = null } = await searchParams;
  const now = new Date();

  const supabase = await createSupabaseServerClient();
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
        eyebrow="Intake"
        title="Requests and approvals"
        description="Propose work that does not exist yet, and answer the decisions waiting on you."
        actions={
          <EntityFormDialog
            triggerLabel="Propose something"
            title="Propose a project"
            submitLabel="Submit request"
            action={submitProjectRequest}
            fields={[
              { name: "title", label: "What are you proposing", type: "text", required: true },
              {
                name: "summary",
                label: "What would it involve",
                type: "textarea",
                required: true,
              },
              { name: "rationale", label: "Why now", type: "textarea" },
              {
                name: "beneficiaries",
                label: "Who it serves",
                type: "textarea",
                hint: "The question most often left out, and the one trustees ask first.",
              },
              {
                name: "programId",
                label: "Part of a program",
                type: "select",
                colSpan: 1,
                options: programOptions,
              },
              {
                name: "sponsorId",
                label: "Staff sponsor",
                type: "select",
                colSpan: 1,
                options: options.people.map((p) => ({ value: p.id, label: p.label })),
              },
              { name: "neededBy", label: "Needed by", type: "date", colSpan: 1 },
              {
                name: "estimatedEffort",
                label: "Rough effort",
                type: "text",
                colSpan: 1,
                placeholder: "A few weekends",
              },
            ]}
          />
        }
      />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="intake-queue">
          <h2 id="intake-queue" className="section-heading mb-3">
            Open requests
            <span className="ml-2 font-normal text-muted">{board.open.length}</span>
          </h2>

          {board.open.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck aria-hidden />}
              title="Nothing waiting"
              description="Proposals appear here from the moment they are submitted, oldest first, so nothing sits unanswered without anybody noticing."
            />
          ) : (
            <ul className="card divide-y divide-line">
              {board.open.map((request) => (
                <RequestItem
                  key={request.id}
                  request={request}
                  now={now}
                  canDecide={session.isStaff}
                  highlighted={request.id === highlightId}
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
                Decided ({board.settled.length})
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
                        {REQUEST_STATUS_LABELS[request.status]}
                      </Badge>
                    </div>
                    <p className="meta mt-0.5">
                      {request.requester?.full_name ?? "Someone"}
                      {request.decided_at
                        ? ` · decided ${formatDate(request.decided_at)}`
                        : ""}
                      {request.decider ? ` by ${request.decider.full_name}` : ""}
                    </p>
                    {request.project ? (
                      <p className="mt-0.5 text-[13px]">
                        <Link
                          href={`/projects/${request.project.id}`}
                          className="font-medium text-brand-fg hover:underline"
                        >
                          {request.project.name}
                        </Link>
                        <span className="text-muted"> — the project this became</span>
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
            heading="Waiting on you"
            empty="Nothing needs your decision."
            approvals={board.waitingOnMe}
            actionable
          />
          <ApprovalList
            id="waiting-on-others"
            heading="You asked for"
            empty=""
            approvals={board.waitingOnOthers}
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
  canDecide,
  highlighted,
}: {
  request: ProjectRequestRow;
  now: Date;
  canDecide: boolean;
  highlighted: boolean;
}) {
  const waiting = daysWaiting(request.created_at, now);
  const stale = requestIsStale(request, now);

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
          {REQUEST_STATUS_LABELS[request.status]}
        </Badge>
      </div>

      <p className="meta mt-0.5">
        {request.requester?.full_name ?? "Someone"}
        {` · waiting ${waiting} ${waiting === 1 ? "day" : "days"}`}
        {request.sponsor ? ` · sponsor ${request.sponsor.full_name}` : " · no sponsor"}
        {request.program ? ` · ${request.program.name}` : ""}
        {request.needed_by ? ` · needed by ${formatDate(request.needed_by)}` : ""}
      </p>

      {stale ? (
        <p className="mt-1 text-[13px] text-warning-fg">
          Nobody has answered this in {waiting} days.
        </p>
      ) : null}

      <p className="mt-1 text-[13px]">{request.summary}</p>
      {request.beneficiaries ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">Serves: </span>
          {request.beneficiaries}
        </p>
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

function subjectOf(approval: ApprovalRow): { label: string; href: string | null } {
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
  return { label: "An unknown record", href: null };
}

function ApprovalList({
  id,
  heading,
  empty,
  approvals,
  actionable = false,
}: {
  id: string;
  heading: string;
  empty: string;
  approvals: ApprovalRow[];
  actionable?: boolean;
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
            const subject = subjectOf(approval);
            return (
              <li key={approval.id} className="px-4 py-3">
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
                    ? `${approval.requester?.full_name ?? "Someone"} asked you`
                    : `Waiting on ${approval.approver?.full_name ?? "someone"}`}
                  {approval.due_at ? ` · by ${formatDate(approval.due_at)}` : ""}
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
