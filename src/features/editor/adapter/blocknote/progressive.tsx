"use client";

import * as React from "react";
import { ListPlus } from "lucide-react";
import type { BlockNoteEditor } from "@blocknote/core";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import type { EditorT } from "@/features/editor/i18n";
import { blockText, CONTENT_VERSION, type EditorBlock, type EditorContent } from "@/features/editor/adapter/content";
import type { EditorSemanticHandlers, TaskSuggestionOptions } from "@/features/editor/adapter/types";
import { suggestTask, type TaskSuggestion } from "@/features/editor/semantic/suggest";

/**
 * Progressive structure (M6): selected lines become tasks or a page, and a
 * line that names a person and a date gets a quiet margin icon offering to
 * make it a task. The original text always stays; the new object is linked
 * beside it as a semantic block.
 */

// The schema's block types are not visible here; the editor is used through
// the operations every BlockNote editor has, with loosely typed blocks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const objectBlock = (type: "task" | "pageLink", objectId: string): any => ({ type, props: { objectId } });
type AnyBlock = { id: string; type: string } & EditorBlock;

const TEXT_TYPES = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "callout"]);

function announce(text: string) {
  const live = document.getElementById("qbbe-editor-live");
  if (live) live.textContent = text;
}

function useProjects(handlers: EditorSemanticHandlers) {
  const [projects, setProjects] = React.useState<{ id: string; name: string }[] | null>(null);
  React.useEffect(() => {
    let active = true;
    void handlers
      .projects()
      .then((rows) => active && setProjects(rows))
      .catch(() => active && setProjects([]));
    return () => {
      active = false;
    };
  }, [handlers]);
  return projects;
}

/** The document's own project when it is offered (a meeting's), else the first one. */
function firstProject(projects: { id: string; name: string }[] | null, handlers: EditorSemanticHandlers): string {
  const preferred = handlers.defaultProjectId;
  if (preferred && projects?.some((project) => project.id === preferred)) return preferred;
  return projects?.[0]?.id ?? "";
}

function ProjectField({ t, projects, value, onChange }: { t: EditorT; projects: { id: string; name: string }[] | null; value: string; onChange: (value: string) => void }) {
  const id = React.useId();
  return (
    <div>
      <Label htmlFor={id}>{t("semantic.picker.project")}</Label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("semantic.picker.noProject")}</option>
        {(projects ?? []).map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** "Turn into tasks…": one task per selected line, each inserted after its line. */
export function TurnIntoTasksDialog({
  editor,
  blocks,
  handlers,
  t,
  onClose,
}: {
  editor: AnyEditor;
  blocks: AnyBlock[];
  handlers: EditorSemanticHandlers;
  t: EditorT;
  onClose: () => void;
}) {
  const lines = blocks
    .filter((block) => TEXT_TYPES.has(block.type))
    .map((block) => ({ block, title: blockText({ ...block, children: [] }).trim() }))
    .filter((line) => line.title.length > 0)
    .map((line) => ({ ...line, title: line.title.slice(0, 300) }));
  const projects = useProjects(handlers);
  const [projectId, setProjectId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const chosen = projectId || firstProject(projects, handlers);

  return (
    <Dialog open onClose={onClose} title={t("progressive.turnTitle")}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          for (const line of lines) {
            const task = await handlers.createTask(line.title, chosen || null).catch(() => null);
            if (!task) {
              setBusy(false);
              setError(t("semantic.failed"));
              return;
            }
            editor.insertBlocks([objectBlock("task", task.id)], line.block.id, "after");
          }
          setBusy(false);
          announce(t("progressive.tasksDone"));
          onClose();
          requestAnimationFrame(() => editor.focus());
        }}
      >
        <p className="mb-3 text-body-sm text-muted">{t("progressive.turnBody")}</p>
        <ul className="mb-3 list-disc pl-5 text-body-sm text-ink">
          {lines.map((line) => (
            <li key={line.block.id}>{line.title}</li>
          ))}
        </ul>
        <ProjectField t={t} projects={projects} value={chosen} onChange={setProjectId} />
        {error ? <p className="mt-2 text-caption text-danger-fg">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("progressive.cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={lines.length === 0 || projects === null}>
            {lines.length === 1 ? t("progressive.turnCreateOne") : t("progressive.turnCreate", { count: lines.length })}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** "Turn into a page": a new page holding a copy of the lines, linked after them. */
export async function turnIntoPage(editor: AnyEditor, blocks: AnyBlock[], handlers: EditorSemanticHandlers, t: EditorT): Promise<boolean> {
  if (!handlers.turnIntoPage || blocks.length === 0) return false;
  const title = blockText({ ...blocks[0], children: [] }).trim().slice(0, 500);
  const content: EditorContent = { version: CONTENT_VERSION, blocks: JSON.parse(JSON.stringify(blocks)) as EditorBlock[] };
  const page = await handlers.turnIntoPage(title, content).catch(() => null);
  if (!page) return false;
  editor.insertBlocks([objectBlock("pageLink", page.id)], blocks[blocks.length - 1].id, "after");
  announce(t("progressive.turnPageDone"));
  return true;
}

interface Placed {
  blockId: string;
  suggestion: TaskSuggestion;
  top: number;
}

/**
 * Quiet margin icons for lines that look like tasks. Recomputed a moment
 * after typing stops; never opens anything on its own.
 */
export function SuggestionLayer({
  editor,
  containerRef,
  options,
  handlers,
  t,
  version,
}: {
  editor: AnyEditor;
  containerRef: React.RefObject<HTMLDivElement | null>;
  options: TaskSuggestionOptions;
  handlers: EditorSemanticHandlers;
  t: EditorT;
  /** Changes whenever the document changes. */
  version: number;
}) {
  const [placed, setPlaced] = React.useState<Placed[]>([]);
  const [open, setOpen] = React.useState<Placed | null>(null);
  const dismissed = React.useRef(new Set<string>());

  React.useEffect(() => {
    if (!options.enabled) return;
    const compute = () => {
      const root = containerRef.current;
      if (!root) return;
      const base = root.getBoundingClientRect();
      const top = editor.document as AnyBlock[];
      const next: Placed[] = [];
      top.forEach((block, index) => {
        if (!TEXT_TYPES.has(block.type) || dismissed.current.has(block.id)) return;
        if (top[index + 1]?.type === "task") return;
        const suggestion = suggestTask(blockText({ ...block, children: [] }), options.people, options.today);
        if (!suggestion) return;
        const el = root.querySelector<HTMLElement>(`[data-node-type="blockOuter"][data-id="${CSS.escape(block.id)}"], [data-id="${CSS.escape(block.id)}"]`);
        if (!el) return;
        next.push({ blockId: block.id, suggestion, top: el.getBoundingClientRect().top - base.top });
      });
      setPlaced(next);
    };
    const timer = setTimeout(compute, 400);
    window.addEventListener("resize", compute);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", compute);
    };
  }, [editor, containerRef, options, version]);

  if (!options.enabled) return null;
  return (
    <>
      {placed.map((item) => (
        <button
          key={item.blockId}
          type="button"
          aria-label={t("progressive.suggestion", { title: item.suggestion.title })}
          title={t("progressive.suggestion", { title: item.suggestion.title })}
          onClick={() => setOpen(item)}
          className="absolute right-0 inline-flex size-7 items-center justify-center rounded-(--radius-sm) text-muted hover:bg-surface-soft hover:text-ink"
          style={{ top: item.top }}
        >
          <ListPlus className="size-4" aria-hidden />
        </button>
      ))}
      {open ? (
        <SuggestDialog
          item={open}
          handlers={handlers}
          t={t}
          onClose={(created) => {
            if (!created) dismissed.current.add(open.blockId);
            setPlaced((rows) => rows.filter((row) => row.blockId !== open.blockId));
            setOpen(null);
          }}
          onCreated={(taskId) => {
            editor.insertBlocks([objectBlock("task", taskId)], open.blockId, "after");
            announce(t("progressive.tasksDone"));
          }}
        />
      ) : null}
    </>
  );
}

function SuggestDialog({
  item,
  handlers,
  t,
  onClose,
  onCreated,
}: {
  item: Placed;
  handlers: EditorSemanticHandlers;
  t: EditorT;
  onClose: (created: boolean) => void;
  onCreated: (taskId: string) => void;
}) {
  const [title, setTitle] = React.useState(item.suggestion.title);
  const [due, setDue] = React.useState(item.suggestion.due);
  const projects = useProjects(handlers);
  const [projectId, setProjectId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const titleId = React.useId();
  const dueId = React.useId();
  const chosen = projectId || firstProject(projects, handlers);

  return (
    <Dialog open onClose={() => onClose(false)} title={t("progressive.suggestTitle")}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          const task = await handlers
            .createTask(title.trim(), chosen || null, { assigneeId: item.suggestion.personId, dueAt: due || undefined })
            .catch(() => null);
          setBusy(false);
          if (!task) {
            setError(t("semantic.failed"));
            return;
          }
          onCreated(task.id);
          onClose(true);
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-body-sm text-muted">{t("progressive.suggestBody", { person: item.suggestion.personName })}</p>
        <div>
          <Label htmlFor={titleId}>{t("progressive.fieldTitle")}</Label>
          <Input id={titleId} value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div>
          <Label htmlFor={dueId}>{t("progressive.fieldDue")}</Label>
          <Input id={dueId} type="date" value={due} onChange={(event) => setDue(event.target.value)} />
        </div>
        <p className="text-body-sm text-ink">{t("progressive.fieldAssignee", { person: item.suggestion.personName })}</p>
        <ProjectField t={t} projects={projects} value={chosen} onChange={setProjectId} />
        {error ? <p className="text-caption text-danger-fg">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onClose(false)}>
            {t("progressive.cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={!title.trim() || projects === null}>
            {t("progressive.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
