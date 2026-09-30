"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Switch, Textarea } from "@/components/ui/input";
import { fill, type WorkflowsMessages } from "../i18n";
import { saveWorkflow, setWorkflowStopped } from "../services/workflow.commands";

const sectionClass = "rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5";

/** The instant stop switch (V1-12). */
export function StopSwitch({
  id,
  stoppedAt,
  stoppedLabel,
  m,
}: {
  id: string;
  stoppedAt: string | null;
  /** When it was stopped, already formatted for the reader. */
  stoppedLabel: string;
  m: WorkflowsMessages;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const stopped = stoppedAt !== null;

  const toggle = () => {
    setMessage(null);
    start(async () => {
      const result = await setWorkflowStopped({ id, stop: !stopped });
      setMessage(result.ok ? { tone: "ok", text: m.stop.done } : { tone: "error", text: result.error });
      if (result.ok) router.refresh();
    });
  };

  return (
    <section className={sectionClass} aria-labelledby="workflow-stop">
      <h2 id="workflow-stop" className="section-heading mb-1">{m.stop.heading}</h2>
      <p className="mb-3 text-sm text-muted">
        {stopped ? fill(m.stop.stopped, { when: stoppedLabel }) : m.stop.running}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant={stopped ? "secondary" : "danger"} loading={pending} onClick={toggle}>
          {stopped ? m.stop.resume : m.stop.stop}
        </Button>
        <p role={message?.tone === "error" ? "alert" : "status"}
          className={message?.tone === "error" ? "text-sm text-danger-fg" : "text-sm text-success-fg"}>
          {message?.text ?? ""}
        </p>
      </div>
    </section>
  );
}

/**
 * The whole definition as JSON, for what the step list cannot show: branches,
 * loops, sub-workflows and retries. The server validates it on save.
 */
export function JsonWorkflowEditor({
  id,
  initial,
  m,
}: {
  id: string;
  initial: { name: string; description: string; enabled: boolean; maxRunsPerHour: number; graph: unknown };
  m: WorkflowsMessages;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [maxRunsPerHour, setMaxRuns] = React.useState(initial.maxRunsPerHour);
  const [text, setText] = React.useState(JSON.stringify(initial.graph, null, 2));
  const [pending, start] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    let graph: unknown;
    try {
      graph = JSON.parse(text);
    } catch (cause) {
      setMessage({ tone: "error", text: fill(m.json.invalidJson, { detail: cause instanceof Error ? cause.message : "" }) });
      return;
    }
    start(async () => {
      const result = await saveWorkflow({ id, name, description: initial.description, enabled, maxRunsPerHour, graph });
      setMessage(result.ok ? { tone: "ok", text: m.form.saved } : { tone: "error", text: result.error });
      if (result.ok) router.refresh();
    });
  };

  return (
    <form onSubmit={onSave} className={`${sectionClass} space-y-4`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="json-name">{m.form.name}</Label>
          <Input id="json-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="json-max-runs">{m.form.maxRunsPerHour}</Label>
          <Input id="json-max-runs" type="number" min={1} max={1000} required value={maxRunsPerHour}
            onChange={(event) => setMaxRuns(Number(event.target.value))} />
        </div>
        <div className="flex items-center gap-3 sm:pt-7">
          <Switch id="json-enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <label htmlFor="json-enabled" className="text-sm font-medium text-ink">{m.form.enabled}</label>
        </div>
      </div>
      <div>
        <Label htmlFor="json-graph">{m.json.label}</Label>
        <Textarea id="json-graph" className="min-h-96 font-mono text-[13px]" spellCheck={false} value={text}
          aria-describedby="json-graph-hint" onChange={(event) => setText(event.target.value)} />
        <p id="json-graph-hint" className="mt-1 text-[12.5px] text-muted">{m.json.hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>{m.form.save}</Button>
        <p role={message?.tone === "error" ? "alert" : "status"}
          className={message?.tone === "error" ? "text-sm text-danger-fg" : "text-sm text-success-fg"}>
          {message?.text ?? ""}
        </p>
      </div>
    </form>
  );
}
