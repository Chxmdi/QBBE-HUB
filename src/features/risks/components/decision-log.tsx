"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  createDecisionRequest,
  declineDecisionRequest,
  recordProjectDecision,
  reopenDecision,
} from "@/features/risks/services/decision.commands";
import type { DecisionRequestRow, DecisionRow } from "@/features/risks/services/decision.queries";
import { formatDate } from "@/lib/utils";

const DECISION_FIELDS = [
  { name: "title", label: "The decision", type: "text" as const, required: true },
  { name: "detail", label: "Rationale", type: "textarea" as const },
  { name: "alternatives", label: "Alternatives considered", type: "textarea" as const },
  {
    name: "affectedRecords",
    label: "Affected records",
    type: "textarea" as const,
    hint: "One record per line.",
  },
  { name: "reopenConditions", label: "What would reopen it", type: "textarea" as const },
];

export function DecisionLog({
  projectId,
  decisions,
  requests,
  people,
  canManage,
}: {
  projectId: string;
  decisions: DecisionRow[];
  requests: DecisionRequestRow[];
  people: { id: string; label: string }[];
  canManage: boolean;
}) {
  const peopleOptions = people.map((person) => ({ value: person.id, label: person.label }));
  const openRequests = requests.filter((request) => request.status === "open");

  return (
    <div className="mt-10 space-y-10">
      <section aria-labelledby="project-decisions">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-decisions" className="section-heading">
            Decisions
            <span className="ml-2 font-normal text-muted">{decisions.length}</span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel="Record a decision"
              triggerVariant="secondary"
              title="Record a decision"
              submitLabel="Record decision"
              extraValues={{ projectId }}
              action={recordProjectDecision}
              fields={DECISION_FIELDS}
            />
          ) : null}
        </div>
        {decisions.length === 0 ? (
          <EmptyState
            icon={<Scale aria-hidden />}
            title="No decisions yet"
            description="Record what was decided, why, and what would reopen it."
          />
        ) : (
          <ul className="card divide-y divide-line">
            {decisions.map((decision) => (
              <DecisionItem key={decision.id} decision={decision} canManage={canManage} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="decision-requests">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="decision-requests" className="section-heading">
            Decision requests
            <span className="ml-2 font-normal text-muted">{openRequests.length} open</span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel="Request a decision"
              triggerVariant="secondary"
              title="Request a decision"
              submitLabel="Send request"
              extraValues={{ projectId }}
              action={createDecisionRequest}
              fields={[
                {
                  name: "assigneeId",
                  label: "Ask",
                  type: "select",
                  required: true,
                  options: peopleOptions,
                },
                { name: "dueAt", label: "Due", type: "date", required: true, colSpan: 1 },
                { name: "context", label: "What needs deciding", type: "textarea", required: true },
              ]}
            />
          ) : null}
        </div>
        {requests.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            No decision has been requested.
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {requests.map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                projectId={projectId}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DecisionItem({
  decision,
  canManage,
}: {
  decision: DecisionRow;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const affected = Array.isArray(decision.affected_records) ? decision.affected_records : [];

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{decision.title}</span>
        {decision.reopened_at ? <Badge tone="warning">Reopened</Badge> : <Badge tone="neutral">Decided</Badge>}
      </div>
      <p className="meta mt-0.5">
        {decision.owner?.full_name ?? "Unknown owner"} · {formatDate(decision.decided_at)}
      </p>
      {decision.detail ? <p className="mt-1 text-[13px]">{decision.detail}</p> : null}
      {decision.alternatives ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">Alternatives: </span>
          {decision.alternatives}
        </p>
      ) : null}
      {affected.length > 0 ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">Affects: </span>
          {affected.join(", ")}
        </p>
      ) : null}
      {decision.reopen_conditions ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">Reopen if: </span>
          {decision.reopen_conditions}
        </p>
      ) : null}
      {canManage && !decision.reopened_at ? (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const result = await reopenDecision({ decisionId: decision.id });
              setBusy(false);
              if (!result.ok) {
                setError(result.error ?? "Could not reopen the decision.");
                return;
              }
              router.refresh();
            }}
          >
            Reopen
          </Button>
          {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

function RequestItem({
  request,
  projectId,
  canManage,
}: {
  request: DecisionRequestRow;
  projectId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[13.5px]">{request.context}</span>
        <Badge tone={request.status === "open" ? "warning" : "neutral"}>{request.status}</Badge>
      </div>
      <p className="meta mt-0.5">
        {request.assignee?.full_name ?? "Unassigned"} · due {formatDate(request.due_at)}
        {request.requester ? ` · asked by ${request.requester.full_name}` : ""}
      </p>
      {request.status === "open" && canManage ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <EntityFormDialog
            triggerLabel="Record the decision"
            triggerVariant="secondary"
            title="Record the decision"
            submitLabel="Record decision"
            extraValues={{ projectId, requestId: request.id }}
            action={recordProjectDecision}
            fields={DECISION_FIELDS}
          />
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const result = await declineDecisionRequest({ requestId: request.id });
              setBusy(false);
              if (!result.ok) {
                setError(result.error ?? "Could not decline the request.");
                return;
              }
              router.refresh();
            }}
          >
            Decline
          </Button>
          {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
