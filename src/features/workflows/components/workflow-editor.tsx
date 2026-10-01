"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Switch, Textarea } from "@/components/ui/input";
import type { LensCatalog } from "@/lib/query/catalog";
import {
  editorIssues,
  editorObjectTypes,
  editorStepKinds,
  editorToGraph,
  newStep,
  removeStep,
  type EditorState,
  type EditorStep,
  type EditorStepKind,
} from "../editor-model";
import { objectEventVerbs } from "../graph";
import { fill, type WorkflowsMessages } from "../i18n";
import { changedPropertyOptions } from "../picker-options";
import { saveWorkflow } from "../services/workflow.commands";
import { Combobox } from "./pickers/combobox";
import { StepFields, type StepEditorContext } from "./step-editors";

export { TestRunPanel } from "./test-run-panel";

interface Props {
  id: string | null;
  initial: EditorState;
  m: WorkflowsMessages;
  /** The lens catalog, for the property pickers; empty when it could not load. */
  catalog: LensCatalog;
  locale: string;
  /** Other workflows, for sub-workflow steps. */
  workflows: { id: string; name: string }[];
}

const sectionClass = "rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5";
const OTHER_KINDS = editorStepKinds.filter((kind) => kind !== "condition" && kind !== "action");

export function WorkflowEditor({ id, initial, m, catalog, locale, workflows }: Props) {
  const router = useRouter();
  const [state, setState] = React.useState<EditorState>(initial);
  const [otherKind, setOtherKind] = React.useState<EditorStepKind>("branch");
  const [saving, startSaving] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [showPropertyKey, setShowPropertyKey] = React.useState(false);

  const update = (patch: Partial<EditorState>) => setState((current) => ({ ...current, ...patch }));
  const setStep = (index: number, step: EditorStep) =>
    update({ steps: state.steps.map((existing, position) => (position === index ? step : existing)) });
  const moveStep = (index: number, by: -1 | 1) => {
    const steps = [...state.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + by, 0, step);
    update({ steps });
  };
  const addStep = (kind: EditorStepKind) => update({ steps: [...state.steps, newStep(kind, state.steps)] });

  const objectTypes = React.useMemo(() => (state.objectType ? [state.objectType] : []), [state.objectType]);
  const propertyKeys = React.useMemo(
    () => changedPropertyOptions(catalog, objectTypes, locale),
    [catalog, objectTypes, locale],
  );
  const ctx: StepEditorContext = {
    catalog,
    locale,
    objectTypes,
    steps: state.steps.map((step) => ({ id: step.id, kind: step.kind })),
    workflows: workflows.filter((workflow) => workflow.id !== id),
    m,
  };

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const issues = editorIssues(state);
    if (issues.length > 0) {
      setMessage({ tone: "error", text: fill(m.steps.issues[issues[0].code], { id: issues[0].stepId }) });
      return;
    }
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

  const currentProperty = propertyKeys.find((option) => option.key === state.changedProperty);

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
            <Combobox
              id="workflow-property"
              label={m.trigger.changedProperty}
              hint={m.trigger.changedPropertyHint}
              selectedLabel={currentProperty ? currentProperty.name : state.changedProperty}
              groups={[{ label: "", options: propertyKeys.map((option) => ({ id: option.key, label: option.name, description: option.key })) }]}
              m={m.picker}
              fill={fill}
              onSelect={(option) => update({ changedProperty: option.id })}
              onClear={() => update({ changedProperty: "" })}
            />
            <button
              type="button"
              className="mt-1 text-[12.5px] text-brand-fg underline-offset-2 hover:underline"
              aria-expanded={showPropertyKey}
              aria-controls="workflow-property-advanced"
              onClick={() => setShowPropertyKey((shown) => !shown)}
            >
              {m.picker.advanced}
            </button>
            <div id="workflow-property-advanced" hidden={!showPropertyKey} className="mt-1">
              <Label htmlFor="workflow-property-key">{m.trigger.propertyKey}</Label>
              <Input
                id="workflow-property-key"
                maxLength={64}
                value={state.changedProperty}
                onChange={(event) => update({ changedProperty: event.target.value })}
              />
            </div>
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
            <li key={step.id} className="rounded-(--radius-sm) border border-line bg-surface-soft p-3">
              <StepEditor
                step={step}
                index={index}
                count={state.steps.length}
                ctx={ctx}
                onChange={(next) => setStep(index, next)}
                onMove={(by) => moveStep(index, by)}
                onRemove={() => update({ steps: removeStep(state.steps, index) })}
              />
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => addStep("condition")}>
            {m.steps.addCondition}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => addStep("action")}>
            {m.steps.addAction}
          </Button>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="workflow-other-kind">{m.steps.otherKind}</Label>
              <Select id="workflow-other-kind" value={otherKind} className="w-56"
                onChange={(event) => setOtherKind(event.target.value as EditorStepKind)}>
                {OTHER_KINDS.map((kind) => <option key={kind} value={kind}>{m.steps.kinds[kind]}</option>)}
              </Select>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => addStep(otherKind)}>
              {m.steps.addStep}
            </Button>
          </div>
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
  ctx,
  onChange,
  onMove,
  onRemove,
}: {
  step: EditorStep;
  index: number;
  count: number;
  ctx: StepEditorContext;
  onChange: (step: EditorStep) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { m } = ctx;
  const number = index + 1;
  const prefix = `step-${number}`;
  return (
    <fieldset>
      <legend className="flex w-full flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {fill(m.steps.stepLabel, { number })} · {m.steps.kinds[step.kind]}
          <span className="ml-2 font-mono text-[12px] font-normal text-muted">{step.id}</span>
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
      <div className="mb-3 sm:w-80">
        <Label htmlFor={`${prefix}-label`}>{m.steps.label}</Label>
        <Input id={`${prefix}-label`} maxLength={120} value={step.label}
          onChange={(event) => onChange({ ...step, label: event.target.value })} />
      </div>
      <StepFields step={step} prefix={prefix} ctx={ctx} onChange={onChange} />
    </fieldset>
  );
}
