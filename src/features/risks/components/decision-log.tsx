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
import { useFormatters, useT } from "@/lib/i18n/client";
import type { TranslateFn } from "@/lib/i18n/translate";

const decisionFields = (t: TranslateFn) => [
  { name: "title", label: t("risks.decisions.fields.title"), type: "text" as const, required: true },
  { name: "detail", label: t("risks.decisions.fields.detail"), type: "textarea" as const },
  {
    name: "alternatives",
    label: t("risks.decisions.fields.alternatives"),
    type: "textarea" as const,
  },
  {
    name: "affectedRecords",
    label: t("risks.decisions.fields.affectedRecords"),
    type: "textarea" as const,
    hint: t("risks.decisions.fields.affectedHint"),
  },
  {
    name: "reopenConditions",
    label: t("risks.decisions.fields.reopenConditions"),
    type: "textarea" as const,
  },
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
  const t = useT();
  const peopleOptions = people.map((person) => ({ value: person.id, label: person.label }));
  const openRequests = requests.filter((request) => request.status === "open");

  return (
    <div className="mt-10 space-y-10">
      <section aria-labelledby="project-decisions">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-decisions" className="section-heading">
            {t("risks.decisions.heading")}
            <span className="ml-2 font-normal text-muted">{decisions.length}</span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel={t("risks.decisions.record")}
              triggerVariant="secondary"
              title={t("risks.decisions.record")}
              submitLabel={t("risks.decisions.recordSubmit")}
              extraValues={{ projectId }}
              action={recordProjectDecision}
              fields={decisionFields(t)}
            />
          ) : null}
        </div>
        {decisions.length === 0 ? (
          <EmptyState
            icon={<Scale aria-hidden />}
            title={t("risks.decisions.emptyTitle")}
            description={t("risks.decisions.emptyBody")}
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
            {t("risks.decisions.requestsHeading")}
            <span className="ml-2 font-normal text-muted">
              {t("risks.decisions.openCount", { count: openRequests.length })}
            </span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel={t("risks.decisions.request")}
              triggerVariant="secondary"
              title={t("risks.decisions.request")}
              submitLabel={t("risks.decisions.requestSubmit")}
              extraValues={{ projectId }}
              action={createDecisionRequest}
              fields={[
                {
                  name: "assigneeId",
                  label: t("risks.decisions.ask"),
                  type: "select",
                  required: true,
                  options: peopleOptions,
                },
                { name: "dueAt", label: t("risks.decisions.due"), type: "date", required: true, colSpan: 1 },
                {
                  name: "context",
                  label: t("risks.decisions.context"),
                  type: "textarea",
                  required: true,
                },
              ]}
            />
          ) : null}
        </div>
        {requests.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            {t("risks.decisions.noRequests")}
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
  const t = useT();
  const format = useFormatters();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const affected = Array.isArray(decision.affected_records) ? decision.affected_records : [];

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{decision.title}</span>
        {decision.reopened_at ? (
          <Badge tone="warning">{t("risks.decisions.reopened")}</Badge>
        ) : (
          <Badge tone="neutral">{t("risks.decisions.decided")}</Badge>
        )}
      </div>
      <p className="meta mt-0.5">
        {decision.owner?.full_name ?? t("risks.decisions.unknownOwner")} ·{" "}
        {format.date(decision.decided_at)}
      </p>
      {decision.detail ? <p className="mt-1 text-[13px]">{decision.detail}</p> : null}
      {decision.alternatives ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("risks.decisions.alternativesPrefix")}</span>
          {decision.alternatives}
        </p>
      ) : null}
      {affected.length > 0 ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("risks.decisions.affectsPrefix")}</span>
          {affected.join(", ")}
        </p>
      ) : null}
      {decision.reopen_conditions ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("risks.decisions.reopenIfPrefix")}</span>
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
                setError(result.error ?? t("risks.decisions.reopenError"));
                return;
              }
              router.refresh();
            }}
          >
            {t("risks.decisions.reopen")}
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
  const t = useT();
  const format = useFormatters();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[13.5px]">{request.context}</span>
        <Badge tone={request.status === "open" ? "warning" : "neutral"}>
          {t(`risks.decisions.requestStatus.${request.status}`)}
        </Badge>
      </div>
      <p className="meta mt-0.5">
        {request.assignee?.full_name ?? t("risks.decisions.unassigned")}
        {t("risks.decisions.dueOn", { date: format.date(request.due_at) })}
        {request.requester
          ? t("risks.decisions.askedBy", { name: request.requester.full_name })
          : ""}
      </p>
      {request.status === "open" && canManage ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <EntityFormDialog
            triggerLabel={t("risks.decisions.recordThe")}
            triggerVariant="secondary"
            title={t("risks.decisions.recordThe")}
            submitLabel={t("risks.decisions.recordSubmit")}
            extraValues={{ projectId, requestId: request.id }}
            action={recordProjectDecision}
            fields={decisionFields(t)}
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
                setError(result.error ?? t("risks.decisions.declineError"));
                return;
              }
              router.refresh();
            }}
          >
            {t("risks.decisions.decline")}
          </Button>
          {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
