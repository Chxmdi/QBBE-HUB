"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label, Select, Switch, Textarea } from "@/components/ui/input";
import { taskPriorities, taskStatuses, workflowActionKeys, type WorkflowActionKey } from "../actions-catalog";
import {
  actionFields,
  defaultActionFields,
  editorObjectTypes,
  editorToGraph,
  type EditorState,
  type EditorStep,
} from "../editor-model";
import { conditionOperators, objectEventVerbs } from "../graph";
import { fill, type WorkflowsMessages } from "../i18n";
import { saveWorkflow, testRunWorkflow, type TestRunResult } from "../services/workflow.commands";

interface Props {
  id: string | null;
  initial: EditorState;
  m: WorkflowsMessages;
}

const sectionClass = "rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5";

export function WorkflowEditor({ id, initial, m }: Props) {
  const router = useRouter();
  const [state, setState] = React.useState<EditorState>(initial);
  const [saving, startSaving] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const update = (patch: Partial<EditorState>) => setState((current) => ({ ...current, ...patch }));
  const setStep = (index: number, step: EditorStep) =>
    update({ steps: state.steps.map((existing, position) => (position === index ? step : existing)) });
  const moveStep = (index: number, by: -1 | 1) => {
    const steps = [...state.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + by, 0, step);
    update({ steps });
  };

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startSaving(async () => {
      const result = await saveWorkflow({
        id: id ?? undefined,
        name: state.name,
        description: state.description,
        enabled: state.enabled,
        maxRunsPerHour: state.maxRunsPerHour,
        graph: editorToGraph(state),
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: m.form.saved });
      if (!id) router.push(`/workflows/${result.id}`);
      else router.refresh();
    });
  };

  return (
    <form onSubmit={onSave} className="space-y-5" aria-describedby="workflow-save-message">
      <div className={sectionClass}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="workflow-name">{m.form.name}</Label>
            <Input
              id="workflow-name"
              required
              maxLength={120}
              value={state.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </div>
          <div className="flex items-start gap-3 sm:pt-7">
            <Switch
              id="workflow-enabled"
              checked={state.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
              aria-describedby="workflow-enabled-hint"
            />
            <div>
              <label htmlFor="workflow-enabled" className="text-sm font-medium text-ink">{m.form.enabled}</label>
              <p id="workflow-enabled-hint" className="text-[12.5px] text-muted">{m.form.enabledHint}</p>
            </div>
          </div>
          <div>
            <Label htmlFor="workflow-max-runs">{m.form.maxRunsPerHour}</Label>
            <Input
              id="workflow-max-runs"
              type="number"
              min={1}
              max={1000}
              required
              value={state.maxRunsPerHour}
              aria-describedby="workflow-max-runs-hint"
              onChange={(event) => update({ maxRunsPerHour: Number(event.target.value) })}
            />
            <p id="workflow-max-runs-hint" className="mt-1 text-[12.5px] text-muted">{m.form.maxRunsPerHourHint}</p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="workflow-description">{m.form.description}</Label>
            <Textarea
              id="workflow-description"
              maxLength={1000}
              value={state.description}
              onChange={(event) => update({ description: event.target.value })}
            />
          </div>
        </div>
      </div>

      <section className={sectionClass} aria-labelledby="workflow-trigger">
        <h2 id="workflow-trigger" className="section-heading mb-3">{m.trigger.heading}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="workflow-type">{m.trigger.objectType}</Label>
            <Select
              id="workflow-type"
              value={state.objectType}
              onChange={(event) => update({ objectType: event.target.value })}
            >
              <option value="">{m.trigger.anyType}</option>
              {editorObjectTypes.map((type) => (
                <option key={type} value={type}>{m.types[type]}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="workflow-property">{m.trigger.changedProperty}</Label>
            <Input
              id="workflow-property"
              maxLength={64}
              value={state.changedProperty}
              aria-describedby="workflow-property-hint"
              onChange={(event) => update({ changedProperty: event.target.value })}
            />
            <p id="workflow-property-hint" className="mt-1 text-[12.5px] text-muted">{m.trigger.changedPropertyHint}</p>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[13px] font-medium text-ink">{m.trigger.verbs}</legend>
            <p className="mb-2 text-[12.5px] text-muted">{m.trigger.anyVerb}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {objectEventVerbs.map((verb) => (
                <label key={verb} className="inline-flex items-center gap-2 text-sm text-ink">
                  <Checkbox
                    checked={state.verbs.includes(verb)}
                    onChange={(event) =>
                      update({
                        verbs: event.target.checked
                          ? [...state.verbs, verb]
                          : state.verbs.filter((existing) => existing !== verb),
                      })}
                  />
                  {m.verbs[verb]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="workflow-steps">
        <h2 id="workflow-steps" className="section-heading mb-3">{m.steps.heading}</h2>
        {state.steps.length === 0 ? <p className="mb-3 text-sm text-muted">{m.steps.empty}</p> : null}
        <ol className="space-y-4" aria-label={m.steps.heading}>
          {state.steps.map((step, index) => (
            <li key={index} className="rounded-(--radius-sm) border border-line bg-surface-soft p-3">
              <StepEditor
                step={step}
                index={index}
                count={state.steps.length}
                m={m}
                onChange={(next) => setStep(index, next)}
                onMove={(by) => moveStep(index, by)}
                onRemove={() => update({ steps: state.steps.filter((_, position) => position !== index) })}
              />
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              update({
                steps: [...state.steps, { kind: "condition", path: "event.changes.status.after", op: "eq", value: "" }],
              })}
          >
            {m.steps.addCondition}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              update({
                steps: [...state.steps, { kind: "action", action: "task.set_priority", fields: defaultActionFields("task.set_priority") }],
              })}
          >
            {m.steps.addAction}
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving}>{m.form.save}</Button>
        <p
          id="workflow-save-message"
          role={message?.tone === "error" ? "alert" : "status"}
          className={message?.tone === "error" ? "text-sm text-danger-fg" : "text-sm text-success-fg"}
        >
          {message?.text ?? ""}
        </p>
      </div>
    </form>
  );
}

function StepEditor({
  step,
  index,
  count,
  m,
  onChange,
  onMove,
  onRemove,
}: {
  step: EditorStep;
  index: number;
  count: number;
  m: WorkflowsMessages;
  onChange: (step: EditorStep) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const number = index + 1;
  const prefix = `step-${number}`;
  return (
    <fieldset>
      <legend className="flex w-full flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {fill(m.steps.stepLabel, { number })} · {m.steps.kinds[step.kind]}
        </span>
      </legend>
      <div className="mb-3 flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(-1)}
          aria-label={fill(m.steps.moveUp, { number })}>
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={index === count - 1} onClick={() => onMove(1)}
          aria-label={fill(m.steps.moveDown, { number })}>
          <ArrowDown className="size-4" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={fill(m.steps.remove, { number })}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      {step.kind === "condition" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`${prefix}-path`}>{m.steps.path}</Label>
            <Input id={`${prefix}-path`} required value={step.path} aria-describedby={`${prefix}-path-hint`}
              onChange={(event) => onChange({ ...step, path: event.target.value })} />
            <p id={`${prefix}-path-hint`} className="mt-1 text-[12.5px] text-muted">{m.steps.pathHint}</p>
          </div>
          <div>
            <Label htmlFor={`${prefix}-op`}>{m.steps.operator}</Label>
            <Select id={`${prefix}-op`} value={step.op}
              onChange={(event) => onChange({ ...step, op: event.target.value as typeof step.op })}>
              {conditionOperators.map((op) => <option key={op} value={op}>{m.operators[op]}</option>)}
            </Select>
          </div>
          {step.op === "is_empty" || step.op === "is_not_empty" ? null : (
            <div>
              <Label htmlFor={`${prefix}-value`}>{m.steps.value}</Label>
              <Input id={`${prefix}-value`} value={step.value} aria-describedby={`${prefix}-value-hint`}
                onChange={(event) => onChange({ ...step, value: event.target.value })} />
              <p id={`${prefix}-value-hint`} className="mt-1 text-[12.5px] text-muted">{m.steps.valueHint}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`${prefix}-action`}>{m.steps.action}</Label>
            <Select id={`${prefix}-action`} value={step.action}
              onChange={(event) => {
                const action = event.target.value as WorkflowActionKey;
                onChange({ kind: "action", action, fields: defaultActionFields(action) });
              }}>
              {workflowActionKeys.map((key) => <option key={key} value={key}>{m.actions[key]}</option>)}
            </Select>
          </div>
          {actionFields[step.action].map(({ key }) => (
            <ActionField key={key} name={key} prefix={prefix} value={step.fields[key] ?? ""} m={m}
              onChange={(value) => onChange({ ...step, fields: { ...step.fields, [key]: value } })} />
          ))}
        </div>
      )}
    </fieldset>
  );
}

function ActionField({
  name,
  prefix,
  value,
  m,
  onChange,
}: {
  name: string;
  prefix: string;
  value: string;
  m: WorkflowsMessages;
  onChange: (value: string) => void;
}) {
  const id = `${prefix}-${name}`;
  const label = m.steps[name as "taskId" | "status" | "priority" | "assigneeId" | "userId" | "title" | "link"];
  if (name === "status" || name === "priority") {
    const options = name === "status" ? taskStatuses : taskPriorities;
    const labels = (name === "status" ? m.statuses : m.priorities) as Record<string, string>;
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option key={option} value={option}>{labels[option]}</option>)}
        </Select>
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)}
        aria-describedby={name === "taskId" ? `${id}-hint` : undefined} />
      {name === "taskId" ? <FieldHintWithId id={`${id}-hint`}>{m.steps.taskIdHint}</FieldHintWithId> : null}
    </div>
  );
}

function FieldHintWithId({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} className="mt-1 text-[12.5px] text-muted">{children}</p>;
}

export function TestRunPanel({ id, m, defaultObjectId }: { id: string; m: WorkflowsMessages; defaultObjectId: string }) {
  const router = useRouter();
  const [objectId, setObjectId] = React.useState(defaultObjectId);
  const [before, setBefore] = React.useState("in_progress");
  const [after, setAfter] = React.useState("blocked");
  const [result, setResult] = React.useState<TestRunResult | null>(null);
  const [running, startRunning] = React.useTransition();

  const onRun = (event: React.FormEvent) => {
    event.preventDefault();
    startRunning(async () => {
      const outcome = await testRunWorkflow({ id, objectId: objectId.trim(), before, after });
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  };

  return (
    <section className={sectionClass} aria-labelledby="workflow-test">
      <h2 id="workflow-test" className="section-heading mb-1">{m.test.heading}</h2>
      <p className="mb-3 text-sm text-muted">{m.test.description}</p>
      <form onSubmit={onRun} className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="test-object">{m.test.objectId}</Label>
          <Input id="test-object" required value={objectId} aria-describedby="test-object-hint"
            onChange={(event) => setObjectId(event.target.value)} />
          <FieldHint><span id="test-object-hint">{m.test.objectIdHint}</span></FieldHint>
        </div>
        <div>
          <Label htmlFor="test-before">{m.test.before}</Label>
          <Select id="test-before" value={before} onChange={(event) => setBefore(event.target.value)}>
            {taskStatuses.map((status) => <option key={status} value={status}>{m.statuses[status]}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="test-after">{m.test.after}</Label>
          <Select id="test-after" value={after} onChange={(event) => setAfter(event.target.value)}>
            {taskStatuses.map((status) => <option key={status} value={status}>{m.statuses[status]}</option>)}
          </Select>
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
            <ol className="mt-2 space-y-1 text-sm" aria-label={m.test.heading}>
              {result.steps.map((step) => (
                <li key={step.position} className="text-ink">
                  <span aria-hidden>{step.status === "failed" ? "✕" : step.status === "succeeded" ? "✓" : "–"}</span>{" "}
                  {m.stepKinds[step.kind as keyof typeof m.stepKinds] ?? step.kind} {step.stepId}:{" "}
                  {m.stepStatus[step.status as keyof typeof m.stepStatus] ?? step.status}
                  {step.error ? <span className="text-danger-fg"> ({step.error})</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}
