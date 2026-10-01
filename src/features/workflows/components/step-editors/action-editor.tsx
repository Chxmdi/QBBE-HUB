"use client";

import { Input, Label, Select } from "@/components/ui/input";
import { taskPriorities, taskStatuses, workflowActionKeys, type WorkflowActionKey } from "../../actions-catalog";
import { actionFields, defaultActionFields, type EditorActionStep } from "../../editor-model";
import { PersonPicker } from "../pickers/person-picker";
import { RecordPicker } from "../pickers/record-picker";
import { LinkSelect } from "./link-select";
import { RetryFields } from "./retry-fields";
import type { StepEditorContext } from "./types";

export function ActionEditor({ step, prefix, ctx, onChange }: {
  step: EditorActionStep; prefix: string; ctx: StepEditorContext; onChange: (step: EditorActionStep) => void;
}) {
  const { m } = ctx;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${prefix}-action`}>{m.steps.action}</Label>
        <Select id={`${prefix}-action`} value={step.action}
          onChange={(event) => {
            const action = event.target.value as WorkflowActionKey;
            onChange({ ...step, action, fields: defaultActionFields(action) });
          }}>
          {workflowActionKeys.map((key) => <option key={key} value={key}>{m.actions[key]}</option>)}
        </Select>
      </div>
      {actionFields[step.action].map(({ key }) => (
        <ActionField key={key} name={key} prefix={prefix} value={step.fields[key] ?? ""} ctx={ctx}
          onChange={(value) => onChange({ ...step, fields: { ...step.fields, [key]: value } })} />
      ))}
      <RetryFields prefix={prefix} retry={step.retry} ctx={ctx} onChange={(retry) => onChange({ ...step, retry })} />
      <LinkSelect id={`${prefix}-next`} label={m.steps.next} link={step.next} ctx={ctx} self={step.id}
        onChange={(next) => onChange({ ...step, next })} />
    </div>
  );
}

function ActionField({ name, prefix, value, ctx, onChange }: {
  name: string; prefix: string; value: string; ctx: StepEditorContext; onChange: (value: string) => void;
}) {
  const { m } = ctx;
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
  if (name === "taskId") {
    return (
      <RecordPicker id={id} type="task" value={value} onChange={onChange} m={m} allowThisItem
        label={m.steps.taskId} idLabel={m.steps.recordId} />
    );
  }
  if (name === "assigneeId" || name === "userId") {
    return (
      <PersonPicker id={id} value={value} onChange={onChange} m={m}
        label={label} idLabel={m.steps.personId} idHint={m.steps.personIdHint} />
    );
  }
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
