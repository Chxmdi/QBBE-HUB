"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  createAgendaTemplate,
  createRecordTemplate,
  instantiateRecordTemplate,
  setAgendaTemplateApproval,
  setProjectTemplateApproval,
  setRecordTemplateApproval,
} from "@/features/admin/services/template-catalog.commands";
import { useT } from "@/lib/i18n/client";

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
  const t = useT();
  return (
    <div className="space-y-10">
      <CatalogSection
        id="project-templates"
        title={t("admin.templates.projectTemplates")}
        empty={t("admin.templates.projectEmpty")}
        rows={projectTemplates}
        onApproval={setProjectTemplateApproval}
      />
      <AgendaSection agendas={agendas} />
      <RecordSection records={records} projects={projects} />
    </div>
  );
}

function CatalogSection({
  id,
  title,
  empty,
  rows,
  onApproval,
}: {
  id: string;
  title: string;
  empty: string;
  rows: NamedRow[];
  onApproval: (
    id: string,
    approved: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="section-heading mb-3">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-[13px] text-muted">
          {empty}
        </p>
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
  onApproval: (
    id: string,
    approved: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  extra?: ReactNode;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const approved = Boolean(row.approved_at);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 text-[14px]">
        {row.name}
        <span className="meta ml-2">{approved ? t("admin.templates.approved") : t("admin.templates.draft")}</span>
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
            if (!result.ok)
              setError(result.error ?? t("admin.templates.approvalFailed"));
            else router.refresh();
          });
        }}
      >
        {approved ? t("admin.templates.withdraw") : t("admin.templates.approve")}
      </Button>
      {error ? (
        <p className="basis-full text-[12.5px] text-danger">{error}</p>
      ) : null}
    </li>
  );
}

function AgendaSection({ agendas }: { agendas: NamedRow[] }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="agenda-templates">
      <h2 id="agenda-templates" className="section-heading mb-3">
        {t("admin.templates.agendaTemplates")}
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
            if (!result.ok) setError(result.error ?? t("admin.templates.saveFailed"));
            else {
              formEl.reset();
              router.refresh();
            }
          });
        }}
      >
        <label className="block text-[13px] font-medium">
          {t("admin.templates.name")}
          <Input name="name" required className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          {t("admin.templates.items")}
          <Textarea name="items" required rows={4} className="mt-1" />
        </label>
        {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
        <Button type="submit" size="sm" loading={pending}>
          {t("admin.templates.saveDraft")}
        </Button>
      </form>
      {agendas.length === 0 ? (
        <p className="text-[13px] text-muted">{t("admin.templates.agendaEmpty")}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {agendas.map((row) => (
            <ApprovalRow
              key={row.id}
              row={row}
              onApproval={setAgendaTemplateApproval}
            />
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
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="record-templates">
      <h2 id="record-templates" className="section-heading mb-3">
        {t("admin.templates.recordTemplates")}
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
            if (!result.ok) setError(result.error ?? t("admin.templates.saveFailed"));
            else {
              formEl.reset();
              router.refresh();
            }
          });
        }}
      >
        <label className="block text-[13px] font-medium">
          {t("admin.templates.kind")}
          <Select name="kind" className="mt-1">
            <option value="task">{t("admin.templates.kinds.task")}</option>
            <option value="event">{t("admin.templates.kinds.event")}</option>
            <option value="update">{t("admin.templates.kinds.update")}</option>
            <option value="report">{t("admin.templates.kinds.report")}</option>
          </Select>
        </label>
        <label className="block text-[13px] font-medium">
          {t("admin.templates.templateName")}
          <Input name="name" required className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          {t("admin.templates.recordTitle")}
          <Input name="title" required className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          {t("admin.templates.priority")}
          <Select name="priority" className="mt-1">
            <option value="">{t("admin.templates.priorities.default")}</option>
            <option value="low">{t("admin.templates.priorities.low")}</option>
            <option value="medium">{t("admin.templates.priorities.medium")}</option>
            <option value="high">{t("admin.templates.priorities.high")}</option>
            <option value="critical">{t("admin.templates.priorities.critical")}</option>
          </Select>
        </label>
        <label className="block text-[13px] font-medium sm:col-span-2">
          {t("admin.templates.descriptionLabel")}
          <Textarea name="description" rows={2} className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          {t("admin.templates.eventType")}
          <Input name="eventType" className="mt-1" />
        </label>
        <label className="block text-[13px] font-medium">
          {t("admin.templates.reportType")}
          <Input
            name="reportType"
            placeholder={t("admin.templates.reportTypePlaceholder")}
            className="mt-1"
          />
        </label>
        <label className="block text-[13px] font-medium sm:col-span-2">
          {t("admin.templates.updateSummary")}
          <Textarea name="progressSummary" rows={2} className="mt-1" />
        </label>
        {error ? (
          <p className="text-[12.5px] text-danger sm:col-span-2">{error}</p>
        ) : null}
        <div>
          <Button type="submit" size="sm" loading={pending}>
            {t("admin.templates.saveDraft")}
          </Button>
        </div>
      </form>
      {records.length === 0 ? (
        <p className="text-[13px] text-muted">{t("admin.templates.recordEmpty")}</p>
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
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  return (
    <span className="flex flex-wrap items-center gap-2">
      {kind === "update" ||
      kind === "task" ||
      kind === "event" ||
      kind === "report" ? (
        <Select
          aria-label={t("admin.templates.projectForRecord")}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="h-8 w-auto px-2 text-[13px]"
        >
          <option value="">{t("admin.templates.noProject")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await instantiateRecordTemplate({
              templateId,
              projectId,
            });
            if (!result.ok)
              setError(result.error ?? t("admin.templates.useFailed"));
            else router.refresh();
          });
        }}
      >
        {approved ? t("admin.templates.use") : t("admin.templates.tryToUse")}
      </Button>
      {error ? (
        <span className="basis-full text-[12.5px] text-danger">{error}</span>
      ) : null}
    </span>
  );
}
