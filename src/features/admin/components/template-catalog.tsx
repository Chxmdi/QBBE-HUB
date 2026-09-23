"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  createAgendaTemplate,
  createRecordTemplate,
  instantiateRecordTemplate,
  setAgendaTemplateApproval,
  setProjectTemplateApproval,
  setRecordTemplateApproval,
} from "@/features/admin/services/template-catalog.commands";

interface NamedRow {
  id: string;
  name: string;
  approved_at: string | null;
}

interface RecordRow extends NamedRow {
  kind: string;
}

export function TemplateCatalog({
  projectTemplates,
  agendas,
  records,
  projects,
}: {
  projectTemplates: NamedRow[];
  agendas: NamedRow[];
  records: RecordRow[];
  projects: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-10">
      <CatalogSection
        title="Project templates"
        empty="No project templates yet. Staff can draft one from Projects."
        rows={projectTemplates}
        onApproval={setProjectTemplateApproval}
      />
      <AgendaSection agendas={agendas} />
      <RecordSection records={records} projects={projects} />
    </div>
  );
}

function CatalogSection({
  title,
  empty,
  rows,
  onApproval,
}: {
  title: string;
  empty: string;
  rows: NamedRow[];
  onApproval: (id: string, approved: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <section aria-labelledby={title}>
      <h2 id={title} className="section-heading mb-3">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((row) => (
            <ApprovalRow key={row.id} row={row} onApproval={onApproval} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApprovalRow({
  row,
  onApproval,
  extra,
}: {
  row: NamedRow;
  onApproval: (id: string, approved: boolean) => Promise<{ ok: boolean; error?: string }>;
  extra?: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const approved = Boolean(row.approved_at);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 text-[14px]">
        {row.name}
        <span className="meta ml-2">{approved ? "Approved" : "Draft"}</span>
      </span>
      {extra}
      <Button
        size="sm"
        variant={approved ? "secondary" : "primary"}
        loading={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await onApproval(row.id, !approved);
            if (!result.ok) setError(result.error ?? "Could not update approval.");
            else router.refresh();
          });
        }}
      >
        {approved ? "Withdraw" : "Approve"}
      </Button>
      {error ? <p className="basis-full text-[12.5px] text-danger">{error}</p> : null}
    </li>
  );
}

function AgendaSection({ agendas }: { agendas: NamedRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="agenda-templates">
      <h2 id="agenda-templates" className="section-heading mb-3">
        Agenda templates
      </h2>
      <form
        className="card mb-3 space-y-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formEl = event.currentTarget;
          const form = new FormData(formEl);
          setError(null);
          start(async () => {
            const result = await createAgendaTemplate({
              name: String(form.get("name") ?? ""),
              items: String(form.get("items") ?? ""),
            });
            if (!result.ok) setError(result.error ?? "Could not save.");
            else {
              formEl.reset();
              router.refresh();
            }
          });
        }}
      >
        <label className="block text-[13px] font-medium">
          Name
          <Input name="name" required className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          Items, one title per line
          <Textarea name="items" required rows={4} className="mt-1" />
        </label>
        {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
        <Button type="submit" size="sm" loading={pending}>
          Save draft
        </Button>
      </form>
      {agendas.length === 0 ? (
        <p className="text-[13px] text-muted">No agenda templates yet.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {agendas.map((row) => (
            <ApprovalRow key={row.id} row={row} onApproval={setAgendaTemplateApproval} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecordSection({
  records,
  projects,
}: {
  records: RecordRow[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="record-templates">
      <h2 id="record-templates" className="section-heading mb-3">
        Task, event, update, and report templates
      </h2>
      <form
        className="card mb-3 grid gap-3 p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const formEl = event.currentTarget;
          const form = new FormData(formEl);
          setError(null);
          start(async () => {
            const result = await createRecordTemplate({
              kind: String(form.get("kind") ?? "task"),
              name: String(form.get("name") ?? ""),
              title: String(form.get("title") ?? ""),
              description: String(form.get("description") ?? ""),
              priority: String(form.get("priority") ?? "") || undefined,
              eventType: String(form.get("eventType") ?? ""),
              progressSummary: String(form.get("progressSummary") ?? ""),
              reportType: String(form.get("reportType") ?? ""),
            });
            if (!result.ok) setError(result.error ?? "Could not save.");
            else {
              formEl.reset();
              router.refresh();
            }
          });
        }}
      >
        <label className="block text-[13px] font-medium">
          Kind
          <select name="kind" className="mt-1 h-9.5 w-full rounded-(--radius-sm) border border-line bg-surface px-3 text-sm">
            <option value="task">Task</option>
            <option value="event">Event</option>
            <option value="update">Update</option>
            <option value="report">Report</option>
          </select>
        </label>
        <label className="block text-[13px] font-medium">
          Template name
          <Input name="name" required className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          Record title
          <Input name="title" required className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          Priority (tasks)
          <select name="priority" className="mt-1 h-9.5 w-full rounded-(--radius-sm) border border-line bg-surface px-3 text-sm">
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="block text-[13px] font-medium sm:col-span-2">
          Description
          <Textarea name="description" rows={2} className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          Event type
          <Input name="eventType" className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          Report type
          <Input name="reportType" placeholder="activity" className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium sm:col-span-2">
          Update summary
          <Textarea name="progressSummary" rows={2} className="mt-1" />
        </label>
        {error ? <p className="text-[12.5px] text-danger sm:col-span-2">{error}</p> : null}
        <div>
          <Button type="submit" size="sm" loading={pending}>
            Save draft
          </Button>
        </div>
      </form>
      {records.length === 0 ? (
        <p className="text-[13px] text-muted">No record templates yet.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {records.map((row) => (
            <ApprovalRow
              key={row.id}
              row={row}
              onApproval={setRecordTemplateApproval}
              extra={
                <InstantiateButton
                  templateId={row.id}
                  approved={Boolean(row.approved_at)}
                  kind={row.kind}
                  projects={projects}
                />
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function InstantiateButton({
  templateId,
  approved,
  kind,
  projects,
}: {
  templateId: string;
  approved: boolean;
  kind: string;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  return (
    <span className="flex flex-wrap items-center gap-2">
      {kind === "update" || kind === "task" || kind === "event" || kind === "report" ? (
        <select
          aria-label="Project for the new record"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="h-8 rounded-(--radius-sm) border border-line bg-surface px-2 text-[13px]"
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await instantiateRecordTemplate({ templateId, projectId });
            if (!result.ok) setError(result.error ?? "Could not use this template.");
            else router.refresh();
          });
        }}
      >
        {approved ? "Use" : "Try to use"}
      </Button>
      {error ? <span className="basis-full text-[12.5px] text-danger">{error}</span> : null}
    </span>
  );
}
