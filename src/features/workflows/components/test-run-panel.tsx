"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useFormatters } from "@/lib/i18n/client";
import { taskStatuses } from "../actions-catalog";
import { fill, type WorkflowsMessages } from "../i18n";
import { testRunWorkflow, type TestRunResult, type TestRunStep } from "../services/workflow.commands";
import type { RecentEvent } from "../services/workflow.queries";
import { printValue, type TestStepDetail } from "../test-run-detail";
import { ExampleEventPicker } from "./pickers/example-event-picker";
import { RecordPicker } from "./pickers/record-picker";

const sectionClass = "rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5";

/**
 * A dry run from the workflow screen (M14c, U10): pick a recent real event or
 * describe a sample change, then read what every step saw and would have done.
 */
export function TestRunPanel({
  id,
  m,
  defaultObjectId,
  objectType,
  changedProperty,
  recentEvents,
  timeZone,
}: {
  id: string;
  m: WorkflowsMessages;
  defaultObjectId: string;
  /** The trigger's first object type, for the record search. */
  objectType: string;
  /** The trigger's changed property; the sample change is on it. */
  changedProperty: string;
  recentEvents: RecentEvent[];
  /** The reader's time zone, for event times. */
  timeZone: string;
}) {
  const router = useRouter();
  const f = useFormatters();
  const dateTime = React.useCallback((iso: string) => f.dateTime(iso, timeZone), [f, timeZone]);
  const property = changedProperty || "status";
  const statusLike = property === "status";
  const [objectId, setObjectId] = React.useState(defaultObjectId);
  const [before, setBefore] = React.useState(statusLike ? "in_progress" : "");
  const [after, setAfter] = React.useState(statusLike ? "blocked" : "");
  const [example, setExample] = React.useState<RecentEvent | null>(null);
  const [result, setResult] = React.useState<TestRunResult | null>(null);
  const [running, startRunning] = React.useTransition();

  const onRun = (event: React.FormEvent) => {
    event.preventDefault();
    startRunning(async () => {
      const outcome = await testRunWorkflow({
        id,
        objectId: objectId.trim(),
        before,
        after,
        ...(example ? { eventId: example.id } : {}),
      });
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  };

  const pickExample = (picked: RecentEvent) => {
    setExample(picked);
    setObjectId(picked.objectId);
    const change = picked.changes.find((item) => item.property === property) ?? picked.changes[0];
    setBefore(change?.before === null || change?.before === undefined ? "" : String(change.before));
    setAfter(change?.after === null || change?.after === undefined ? "" : String(change.after));
  };

  const statusOptions = (current: string) =>
    [...taskStatuses, ...(current && !(taskStatuses as readonly string[]).includes(current) ? [current] : [])];
  const beforeLabel = statusLike ? m.test.before : fill(m.test.propertyBefore, { property });
  const afterLabel = statusLike ? m.test.after : fill(m.test.propertyAfter, { property });

  return (
    <section className={sectionClass} aria-labelledby="workflow-test">
      <h2 id="workflow-test" className="section-heading mb-1">{m.test.heading}</h2>
      <p className="mb-3 text-sm text-muted">{m.test.description}</p>
      <form onSubmit={onRun} className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <ExampleEventPicker
            id="test-example"
            events={recentEvents}
            selected={example}
            dateTime={dateTime}
            m={m}
            onPick={pickExample}
            onClear={() => setExample(null)}
          />
          {example ? (
            <p className="mt-1 text-[12.5px] text-muted">
              {fill(m.test.replaying, { summary: example.summary })}{" "}
              <button type="button" className="text-brand-fg underline-offset-2 hover:underline" onClick={() => setExample(null)}>
                {m.test.useSample}
              </button>
            </p>
          ) : null}
        </div>
        <div>
          <RecordPicker
            id="test-object"
            type={objectType || "task"}
            value={objectId}
            onChange={(value) => {
              setObjectId(value);
              setExample(null);
            }}
            label={m.test.findItem}
            idLabel={m.test.objectId}
            m={m}
          />
          <FieldHint><span id="test-object-hint">{m.test.objectIdHint}</span></FieldHint>
        </div>
        <div>
          <Label htmlFor="test-before">{beforeLabel}</Label>
          {statusLike ? (
            <Select id="test-before" value={before} disabled={example !== null} onChange={(event) => setBefore(event.target.value)}>
              {statusOptions(before).map((status) => (
                <option key={status} value={status}>{m.statuses[status as keyof typeof m.statuses] ?? status}</option>
              ))}
            </Select>
          ) : (
            <Input id="test-before" value={before} disabled={example !== null} onChange={(event) => setBefore(event.target.value)} />
          )}
        </div>
        <div>
          <Label htmlFor="test-after">{afterLabel}</Label>
          {statusLike ? (
            <Select id="test-after" value={after} disabled={example !== null} onChange={(event) => setAfter(event.target.value)}>
              {statusOptions(after).map((status) => (
                <option key={status} value={status}>{m.statuses[status as keyof typeof m.statuses] ?? status}</option>
              ))}
            </Select>
          ) : (
            <Input id="test-after" value={after} disabled={example !== null} onChange={(event) => setAfter(event.target.value)} />
          )}
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" loading={running}>{m.test.run}</Button>
        </div>
      </form>
      <div role="status" aria-live="polite" className="mt-4">
        {result && !result.ok ? <p role="alert" className="text-sm text-danger-fg">{result.error}</p> : null}
        {result && result.ok ? (
          <div>
            <p className="text-sm font-semibold text-ink">
              {fill(m.test.result, {
                number: result.runNumber,
                outcome: m.outcomes[result.outcome as keyof typeof m.outcomes] ?? result.outcome,
              })}
            </p>
            <ol className="mt-2 space-y-2 text-sm" aria-label={m.test.heading}>
              {result.steps.map((step) => (
                <li key={step.position} className="rounded-(--radius-sm) border border-line bg-surface-soft p-2.5 text-ink">
                  <TestStepLine step={step} m={m} />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TestStepLine({ step, m }: { step: TestRunStep; m: WorkflowsMessages }) {
  const symbol = step.status === "failed" ? "✕" : step.status === "succeeded" ? "✓" : "–";
  // The trigger has no id of its own worth repeating ("Trigger trigger").
  const heading = fill(step.kind === "trigger" ? m.test.triggerHeading : m.test.stepHeading, {
    kind: m.stepKinds[step.kind as keyof typeof m.stepKinds] ?? step.kind,
    id: step.stepId,
    status: m.stepStatus[step.status as keyof typeof m.stepStatus] ?? step.status,
  });
  return (
    <div>
      <p className="font-medium">
        <span aria-hidden className={step.status === "failed" ? "text-danger-fg" : step.status === "succeeded" ? "text-success-fg" : "text-muted"}>
          {symbol}
        </span>{" "}
        {heading}
        {step.error ? <span className="text-danger-fg"> ({step.error})</span> : null}
      </p>
      <div className="mt-1 text-[13px] text-muted">
        <TestStepDetailView detail={step.detail} m={m} />
      </div>
    </div>
  );
}

function TestStepDetailView({ detail, m }: { detail: TestStepDetail; m: WorkflowsMessages }) {
  switch (detail.kind) {
    case "trigger":
      return (
        <>
          <p>{fill(m.test.triggerLine, { verb: m.verbs[detail.verb as keyof typeof m.verbs] ?? detail.verb, type: detail.objectType, id: detail.objectId })}</p>
          {detail.changes.map((change) => (
            <p key={change.property}>
              {fill(m.test.changeLine, { property: change.property, before: printValue(change.before), after: printValue(change.after) })}
            </p>
          ))}
        </>
      );
    case "condition":
    case "branch":
      return (
        <>
          {detail.tests.length > 1 ? <p>{detail.match === "any" ? m.test.matchAny : m.test.matchAll}</p> : null}
          {detail.tests.map((test) => (
            <p key={test.path}>
              <code className="text-ink">{fill(m.test.testLine, { path: test.path, op: m.operators[test.op as keyof typeof m.operators] ?? test.op, value: printValue(test.value) })}</code>
              {" · "}
              {fill(m.test.actual, { actual: printValue(test.actual) })}
            </p>
          ))}
          <p>
            {detail.kind === "branch"
              ? detail.next ? fill(m.test.branchTo, { id: detail.next }) : m.test.branchEnd
              : detail.matched ? m.test.passed : m.test.notPassed}
          </p>
        </>
      );
    case "action": {
      const template = m.test.wouldHave[detail.action as keyof typeof m.test.wouldHave];
      const vars = Object.fromEntries(Object.entries(detail.input).map(([key, value]) => [key, printValue(value)]));
      if (detail.action === "task.assign" && (detail.input.assigneeId === null || detail.input.assigneeId === undefined || detail.input.assigneeId === "")) {
        vars.assigneeId = m.test.nobody;
      }
      for (const key of ["status", "priority"] as const) {
        const raw = detail.input[key];
        if (typeof raw === "string") {
          const labels = (key === "status" ? m.statuses : m.priorities) as Record<string, string>;
          vars[key] = labels[raw] ?? raw;
        }
      }
      return (
        <>
          {template ? <p>{fill(template, vars)}</p> : null}
          <p>{detail.check ? m.test.checks[detail.check] : ""}</p>
          <p>
            <span className="font-medium">{m.test.actionInput}:</span>{" "}
            <code className="text-ink">{JSON.stringify(detail.input)}</code>
          </p>
        </>
      );
    }
    case "loop":
      return <p>{fill(m.test.loop, { count: detail.count ?? 0, items: detail.items })}</p>;
    case "wait":
      return <p>{fill(m.test.wait, { until: detail.until ?? "—" })}</p>;
    case "approval":
      return <p>{fill(m.test.approval, { title: detail.title })}</p>;
    case "review":
      return <p>{fill(m.test.review, { reviewer: detail.reviewer, instructions: detail.instructions })}</p>;
    case "webhook":
      return (
        <>
          <p>{fill(m.test.webhook, { url: detail.url })}</p>
          <p><code className="text-ink">{JSON.stringify(detail.body)}</code></p>
        </>
      );
    case "email":
      return <p>{fill(m.test.email, { to: detail.to, subject: detail.subject })}</p>;
    case "subworkflow":
      return <p>{fill(m.test.subworkflow, { id: detail.workflowId })}</p>;
    default:
      return detail.input !== null || detail.output !== null
        ? <p><code className="text-ink">{JSON.stringify({ input: detail.input, output: detail.output })}</code></p>
        : null;
  }
}
