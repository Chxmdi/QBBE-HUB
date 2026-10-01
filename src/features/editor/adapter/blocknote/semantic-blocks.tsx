"use client";

import * as React from "react";
import Link from "next/link";
import { createReactBlockSpec } from "@blocknote/react";
import { ExternalLink, FileText, Gavel, LayoutGrid, ListChecks, Plus, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { taskStatusLabel } from "@/components/shared/status-badges";
import { createTranslator } from "@/lib/i18n/translate";
import { formattersFor } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/types/entities";
import type { EditorT } from "@/features/editor/i18n";
import { presetSpec, presetViewBlock, queryPresets, type QueryPreset } from "@/features/editor/semantic/queries";
import { readStoredViewBlock, ViewBlock } from "@/features/lenses/view-block";
import { viewBlocksEnabled } from "@/features/lenses/view-block/view-block.actions";
import type {
  EditorSemanticHandlers,
  QueryRowSummary,
  SemanticKind,
  SemanticSummary,
} from "@/features/editor/adapter/types";

/**
 * Semantic blocks (M5): a block that *is* an object, or shows live data.
 * Each object block stores only `props.objectId`, which M4c's block rows
 * record as the referenced object; the title and state are read live, as the
 * viewer, so nobody sees what they could not open. A task block reads the
 * task's status, due date and assignee that way, so an edit made anywhere
 * else shows in the notes the next time they load.
 */

export const statusStates = ["on_track", "at_risk", "off_track", "blocked", "done"] as const;
type StatusState = (typeof statusStates)[number];

const statusTone: Record<StatusState, "success" | "warning" | "danger" | "info" | "neutral"> = {
  on_track: "success",
  at_risk: "warning",
  off_track: "danger",
  blocked: "danger",
  done: "info",
};

const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

/** Holds the latest handlers, so blocks built once always call the current ones. */
export class HandlersBox {
  private value: EditorSemanticHandlers | null;
  constructor(value: EditorSemanticHandlers | null) {
    this.value = value;
  }
  get current(): EditorSemanticHandlers | null {
    return this.value;
  }
  set(value: EditorSemanticHandlers | null) {
    this.value = value;
  }
}

type HandlersRef = HandlersBox;

/** Summaries are shared across blocks and kept for the editor's lifetime. */
function createSummaryCache(handlers: HandlersRef) {
  const cache = new Map<string, Promise<SemanticSummary | null>>();
  return {
    get(kind: SemanticKind, id: string): Promise<SemanticSummary | null> {
      const key = `${kind}:${id}`;
      if (!cache.has(key)) {
        const api = handlers.current;
        cache.set(key, api ? api.summarize([{ kind, id }]).then((rows) => rows[0] ?? null).catch(() => null) : Promise.resolve(null));
      }
      return cache.get(key)!;
    },
    set(summary: SemanticSummary) {
      cache.set(`${summary.kind}:${summary.id}`, Promise.resolve(summary));
    },
  };
}

function useSummary(cache: ReturnType<typeof createSummaryCache>, kind: SemanticKind, id: string) {
  const [state, setState] = React.useState<{ id: string; summary: SemanticSummary | null } | null>(null);
  React.useEffect(() => {
    let active = true;
    if (!id) return;
    void cache.get(kind, id).then((summary) => {
      if (active) setState({ id, summary });
    });
    return () => {
      active = false;
    };
  }, [cache, kind, id]);
  if (!id || !state || state.id !== id) return { loading: Boolean(id), summary: null };
  return { loading: false, summary: state.summary };
}

function Picker({
  kind,
  t,
  handlers,
  onPick,
  allowCreate = false,
}: {
  kind: SemanticKind;
  t: EditorT;
  handlers: HandlersRef;
  onPick: (summary: SemanticSummary) => void;
  allowCreate?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SemanticSummary[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [people, setPeople] = React.useState<{ id: string; name: string }[]>([]);
  const [ownerId, setOwnerId] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const id = React.useId();
  const kindLabel = t(`semantic.kinds.${kind}`);
  const requireOwnerAndDue = Boolean(handlers.current?.requireOwnerAndDue);
  const missingOwnerOrDue = requireOwnerAndDue && (!ownerId || !dueAt);

  React.useEffect(() => {
    const api = handlers.current;
    if (!allowCreate || !api) return;
    let active = true;
    void api
      .projects()
      .then((rows) => {
        if (!active) return;
        setProjects(rows);
        // The document's own project first (a meeting's), else the first one.
        const preferred = api.defaultProjectId && rows.some((row) => row.id === api.defaultProjectId) ? api.defaultProjectId : "";
        setProjectId((current) => current || preferred || rows[0]?.id || "");
      })
      .catch(() => undefined);
    void api
      .people?.()
      .then((rows) => active && setPeople(rows))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [allowCreate, handlers]);

  React.useEffect(() => {
    const api = handlers.current;
    if (!api) return;
    let active = true;
    const timer = setTimeout(() => {
      void api
        .search(kind, query)
        .then((rows) => active && setResults(rows))
        .catch(() => active && setResults([]));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [handlers, kind, query]);

  return (
    <div className="w-full rounded-(--radius-sm) border border-dashed border-line p-3" onKeyDown={isolateKeys} contentEditable={false}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-caption font-medium text-ink">
        <Search className="size-3.5" aria-hidden />
        {t("semantic.picker.search", { kind: kindLabel })}
      </label>
      <Input id={id} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
      <ul className="mt-2 flex flex-col gap-1" aria-live="polite">
        {results === null ? (
          <li className="text-caption text-muted">{t("semantic.picker.searching")}</li>
        ) : results.length === 0 && !(allowCreate && query.trim()) ? (
          <li className="text-caption text-muted">{t("semantic.picker.noResults")}</li>
        ) : null}
        {(results ?? []).map((row) => (
          <li key={row.id}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              aria-label={t("semantic.picker.choose", { title: row.title })}
              onClick={() => onPick(row)}
            >
              {row.title}
            </Button>
          </li>
        ))}
        {allowCreate && query.trim() ? (
          <li className="flex flex-col gap-1.5 pt-1">
            <Select
              aria-label={t("semantic.picker.project")}
              value={projectId}
              className="h-8 text-caption"
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{t("semantic.picker.noProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <Select
                aria-label={t("semantic.picker.owner")}
                value={ownerId}
                className="h-8 text-caption"
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="">{t("semantic.picker.noOwner")}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
              <Input
                type="date"
                aria-label={t("semantic.picker.due")}
                value={dueAt}
                className="h-8 text-caption"
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>
            {missingOwnerOrDue ? (
              <p id={`${id}-needs`} className="text-caption text-muted">
                {t("semantic.picker.ownerAndDueRequired")}
              </p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              loading={busy}
              disabled={missingOwnerOrDue}
              aria-describedby={missingOwnerOrDue ? `${id}-needs` : undefined}
              onClick={async () => {
                const api = handlers.current;
                if (!api || missingOwnerOrDue) return;
                setBusy(true);
                setError(null);
                const created = await api
                  .createTask(query.trim(), projectId || null, {
                    ...(ownerId ? { assigneeId: ownerId } : {}),
                    ...(dueAt ? { dueAt } : {}),
                  })
                  .catch(() => null);
                setBusy(false);
                if (created) onPick(created);
                else setError(t("semantic.failed"));
              }}
            >
              <Plus className="size-4" aria-hidden />
              {t("semantic.picker.create", { title: query.trim() })}
            </Button>
          </li>
        ) : null}
      </ul>
      {error ? <p className="mt-1 text-caption text-danger-fg">{error}</p> : null}
    </div>
  );
}

function Unavailable({ t }: { t: EditorT }) {
  return (
    <p role="note" className="w-full rounded-(--radius-sm) border border-line p-2 text-body-sm text-muted">
      {t("semantic.unavailable")}
    </p>
  );
}

export function createSemanticBlocks(t: EditorT, locale: Locale, handlers: HandlersRef) {
  const cache = createSummaryCache(handlers);
  const app = createTranslator(locale);
  const format = formattersFor(locale);

  const objectBlock = (type: "task" | "decision" | "person" | "libraryFile" | "pageLink", kind: SemanticKind) =>
    createReactBlockSpec(
      { type, propSchema: { objectId: { default: "" } }, content: "none" },
      {
        render: ({ block, editor }) => (
          <ObjectBlockView
            kind={kind}
            objectId={block.props.objectId}
            editable={editor.isEditable}
            onChoose={(picked) => {
              cache.set(picked);
              editor.updateBlock(block, { props: { objectId: picked.id } });
            }}
            t={t}
            app={app}
            format={format}
            handlers={handlers}
            cache={cache}
          />
        ),
      },
    );

  const status = createReactBlockSpec(
    { type: "status", propSchema: { state: { default: "on_track" as StatusState, values: statusStates } }, content: "inline" },
    {
      render: ({ block, editor, contentRef }) => {
        const state = (statusStates as readonly string[]).includes(block.props.state) ? (block.props.state as StatusState) : "on_track";
        return (
          <div className="flex w-full items-center gap-3">
            <span contentEditable={false}>
              {editor.isEditable ? (
                <span onKeyDown={isolateKeys}>
                  <Select
                    aria-label={t("semantic.status.label")}
                    value={state}
                    className="h-8 w-auto text-caption"
                    onChange={(event) => editor.updateBlock(block, { props: { state: event.target.value as StatusState } })}
                  >
                    {statusStates.map((value) => (
                      <option key={value} value={value}>
                        {t(`semantic.status.${value}`)}
                      </option>
                    ))}
                  </Select>
                </span>
              ) : (
                <Badge tone={statusTone[state]}>{t(`semantic.status.${state}`)}</Badge>
              )}
            </span>
            <div className="min-w-0 flex-1" ref={contentRef} />
          </div>
        );
      },
    },
  );

  const query = createReactBlockSpec(
    {
      type: "query",
      propSchema: {
        preset: { default: "my_open" as QueryPreset, values: queryPresets },
        spec: { default: JSON.stringify(presetSpec("my_open")) },
      },
      content: "none",
    },
    {
      render: ({ block, editor }) => {
        // Version 2 props are a generic view block (U6); the M5 preset list
        // keeps rendering everything else, and can be turned into a view.
        const stored = readStoredViewBlock(block.props.spec);
        if (stored.kind === "view") {
          return (
            <ViewBlock
              blockId={block.id}
              config={stored.raw}
              editable={editor.isEditable}
              onChange={(next) => editor.updateBlock(block, { props: { spec: JSON.stringify(next) } })}
            />
          );
        }
        const preset = (queryPresets as readonly string[]).includes(block.props.preset) ? (block.props.preset as QueryPreset) : "my_open";
        return (
          <QueryList
            spec={block.props.spec}
            preset={preset}
            editable={editor.isEditable}
            onPreset={(next) => editor.updateBlock(block, { props: { preset: next, spec: JSON.stringify(presetSpec(next)) } })}
            onUpgrade={() => editor.updateBlock(block, { props: { spec: JSON.stringify(presetViewBlock(preset)) } })}
            t={t}
            app={app}
            format={format}
            handlers={handlers}
          />
        );
      },
    },
  );

  return {
    task: objectBlock("task", "task"),
    decision: objectBlock("decision", "decision"),
    person: objectBlock("person", "person"),
    libraryFile: objectBlock("libraryFile", "document"),
    pageLink: objectBlock("pageLink", "page"),
    status,
    query,
  };
}

type AppT = ReturnType<typeof createTranslator>;
type Format = ReturnType<typeof formattersFor>;

function ObjectBlockView({
  kind,
  objectId,
  editable,
  onChoose,
  t,
  app,
  format,
  handlers,
  cache,
}: {
  kind: SemanticKind;
  objectId: string;
  editable: boolean;
  onChoose: (picked: SemanticSummary) => void;
  t: EditorT;
  app: AppT;
  format: Format;
  handlers: HandlersRef;
  cache: ReturnType<typeof createSummaryCache>;
}) {
  const { loading, summary } = useSummary(cache, kind, objectId);
  if (!objectId) {
    return editable ? <Picker kind={kind} t={t} handlers={handlers} onPick={onChoose} allowCreate={kind === "task"} /> : <span />;
  }
  if (loading) return <p className="text-body-sm text-muted">{t("semantic.picker.searching")}</p>;
  if (!summary) return <Unavailable t={t} />;
  return <ObjectCard summary={summary} t={t} app={app} format={format} handlers={handlers} cache={cache} editable={editable} />;
}

function ObjectCard({
  summary,
  t,
  app,
  format,
  handlers,
  cache,
  editable,
}: {
  summary: SemanticSummary;
  t: EditorT;
  app: AppT;
  format: Format;
  handlers: HandlersRef;
  cache: ReturnType<typeof createSummaryCache>;
  editable: boolean;
}) {
  const [done, setDone] = React.useState(Boolean(summary.done));
  const [opening, setOpening] = React.useState(false);
  const box = "flex w-full items-center gap-3 rounded-(--radius-sm) border border-line bg-surface p-2.5";

  if (summary.kind === "task") {
    const statusText = summary.detail ? taskStatusLabel((done ? "completed" : summary.detail) as TaskStatus, app) : null;
    return (
      <div className={box} contentEditable={false} onKeyDown={isolateKeys}>
        <Checkbox
          className="size-6"
          checked={done}
          disabled={!editable || summary.archived}
          aria-label={t("semantic.task.markDone", { title: summary.title })}
          onChange={async (event) => {
            const next = event.target.checked;
            setDone(next);
            const ok = await handlers.current?.setTaskDone(summary.id, next).catch(() => false);
            if (!ok) setDone(!next);
            else cache.set({ ...summary, done: next, detail: next ? "completed" : "not_started" });
          }}
        />
        <ListChecks className="size-4 shrink-0 text-muted" aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate text-ink", done && "text-muted line-through")}>{summary.title}</span>
        {summary.assigneeName ? <span className="max-w-40 truncate text-caption text-muted">{summary.assigneeName}</span> : null}
        {summary.dueAt ? (
          <span className="whitespace-nowrap text-caption text-muted">{t("semantic.task.due", { date: format.date(summary.dueAt) })}</span>
        ) : null}
        {summary.archived ? <Badge>{t("semantic.task.archived")}</Badge> : statusText ? <Badge>{statusText}</Badge> : null}
        {summary.href ? (
          <Link href={summary.href} className="inline-flex min-h-6 items-center text-caption text-muted underline hover:text-ink">
            {t("semantic.task.open")}
          </Link>
        ) : null}
      </div>
    );
  }

  if (summary.kind === "decision") {
    return (
      <div className={box} contentEditable={false}>
        <Gavel className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-ink">{summary.title}</span>
        {summary.detail ? <span className="text-caption text-muted">{t("semantic.decision.decidedOn", { date: format.date(summary.detail) })}</span> : null}
        {summary.href ? (
          <Link href={summary.href} className="inline-flex min-h-6 items-center text-caption text-muted underline hover:text-ink">
            {t("semantic.decision.open")}
          </Link>
        ) : null}
      </div>
    );
  }

  if (summary.kind === "person") {
    return (
      <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3 py-1" contentEditable={false}>
        <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
        {summary.href ? (
          <Link href={summary.href} className="truncate text-ink hover:underline">
            {summary.title}
          </Link>
        ) : (
          <span className="truncate text-ink">{summary.title}</span>
        )}
      </div>
    );
  }

  if (summary.kind === "page") {
    return (
      <div className={box} contentEditable={false}>
        <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
          {summary.detail ?? <FileText className="size-4 text-muted" />}
        </span>
        {summary.href ? (
          <Link href={summary.href} className="min-w-0 flex-1 truncate text-ink underline-offset-2 hover:underline">
            {summary.title}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink">{summary.title}</span>
        )}
      </div>
    );
  }

  const ready = summary.detail === "clean";
  return (
    <div className={box} contentEditable={false} onKeyDown={isolateKeys}>
      <FileText className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-ink">{summary.title}</span>
      {ready ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={opening}
          aria-label={t("semantic.file.open", { title: summary.title })}
          onClick={async () => {
            setOpening(true);
            const url = await handlers.current?.openFile(summary.id).catch(() => null);
            setOpening(false);
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          }}
        >
          <ExternalLink className="size-4" aria-hidden />
        </Button>
      ) : (
        <span className="text-caption text-muted">{t("semantic.file.notReady")}</span>
      )}
    </div>
  );
}

function QueryList({
  spec,
  preset,
  editable,
  onPreset,
  onUpgrade,
  t,
  app,
  format,
  handlers,
}: {
  spec: string;
  preset: QueryPreset;
  editable: boolean;
  onPreset: (preset: QueryPreset) => void;
  /** Replaces the preset with a version 2 view block showing the same tasks. */
  onUpgrade: () => void;
  t: EditorT;
  app: AppT;
  format: Format;
  handlers: HandlersRef;
}) {
  const [result, setResult] = React.useState<{ spec: string; rows: QueryRowSummary[] | null } | null>(null);
  const id = React.useId();
  React.useEffect(() => {
    let active = true;
    const api = handlers.current;
    if (!api) return;
    void api
      .runQuery(spec)
      .then((rows) => active && setResult({ spec, rows }))
      .catch(() => active && setResult({ spec, rows: null }));
    return () => {
      active = false;
    };
  }, [handlers, spec]);
  const current = result && result.spec === spec ? result : null;
  // "Turn into a view" only where views run (wos_lenses), since it cannot be undone.
  const [canUpgrade, setCanUpgrade] = React.useState(false);
  React.useEffect(() => {
    if (!editable) return;
    let active = true;
    void viewBlocksEnabled()
      .then((on) => active && setCanUpgrade(on))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [editable]);

  return (
    <section className="w-full rounded-(--radius-sm) border border-line p-3" contentEditable={false} aria-labelledby={id} onKeyDown={isolateKeys}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="text-body-sm font-medium text-ink">
          {t(`semantic.query.${preset}`)}
        </h3>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t("semantic.query.preset")}
              value={preset}
              className="h-8 w-auto text-caption"
              onChange={(event) => onPreset(event.target.value as QueryPreset)}
            >
              {queryPresets.map((value) => (
                <option key={value} value={value}>
                  {t(`semantic.query.${value}`)}
                </option>
              ))}
            </Select>
            {canUpgrade ? (
              <Button type="button" size="sm" variant="secondary" title={t("semantic.query.upgradeHint")} onClick={onUpgrade}>
                <LayoutGrid className="size-3.5" aria-hidden />
                {t("semantic.query.upgrade")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {current === null ? (
        <p className="text-caption text-muted">{t("semantic.picker.searching")}</p>
      ) : current.rows === null ? (
        <p className="text-caption text-danger-fg">{t("semantic.query.failed")}</p>
      ) : current.rows.length === 0 ? (
        <p className="text-caption text-muted">{t("semantic.query.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {current.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <Link href={row.href} className="min-w-0 flex-1 truncate text-ink hover:underline">
                {row.title}
              </Link>
              {row.status ? <Badge>{taskStatusLabel(row.status as TaskStatus, app)}</Badge> : row.statusLabel ? <Badge>{row.statusLabel}</Badge> : null}
              {row.date && row.dateLabel ? (
                <span className="text-caption text-muted">{t(`semantic.query.${row.dateLabel}`, { date: format.date(row.date) })}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
