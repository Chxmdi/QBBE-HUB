"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { createReactBlockSpec, type DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu, type BlockNoteEditor } from "@blocknote/core";
import { Plus, Repeat2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { EditorT } from "@/features/editor/i18n";
import { CONTENT_VERSION, type EditorBlock, type EditorContent } from "@/features/editor/adapter/content";
import type { EditorSemanticHandlers, SyncedAccessState, SyncedBlockView } from "@/features/editor/adapter/types";
import { BlockEditor } from "@/features/editor/adapter/block-editor";
import type { HandlersBox } from "./semantic-blocks";

/**
 * The synced block (U5b): content kept once and shown on several pages.
 * The page it was made on holds it with role "source", where someone who can
 * edit the source changes it; every other page holds a "copy", read-only.
 * The content is read as the viewer: a viewer who cannot read the source sees
 * a request-access state, never the content.
 */

const roles = ["source", "copy"] as const;
type Role = (typeof roles)[number];

const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

const emptyContent = (): EditorContent => ({ version: CONTENT_VERSION, blocks: [{ type: "paragraph" }] });

export function createSyncedBlockSpec(t: EditorT, handlers: HandlersBox) {
  return createReactBlockSpec(
    {
      type: "syncedBlock",
      propSchema: { syncedBlockId: { default: "" }, role: { default: "copy" as Role, values: roles } },
      content: "none",
    },
    {
      render: ({ block, editor }) => (
        <SyncedBlock
          id={block.props.syncedBlockId}
          role={block.props.role === "source" ? "source" : "copy"}
          blockId={block.id}
          editable={editor.isEditable}
          onChoose={(syncedBlockId, role) => editor.updateBlock(block, { props: { syncedBlockId, role } })}
          t={t}
          handlers={handlers}
        />
      ),
    },
  );
}

/** The slash-menu item that inserts an empty synced block. */
export function syncedBlockSlashItem(editor: BlockNoteEditor<never, never, never>, t: EditorT): DefaultReactSuggestionItem {
  return {
    title: t("syncedBlock.slash.title"),
    subtext: t("syncedBlock.slash.subtext"),
    aliases: t("syncedBlock.slash.aliases").split(","),
    group: t("slash.group"),
    icon: <Repeat2 size={18} aria-hidden />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: "syncedBlock" } as never);
    },
  };
}

/**
 * Block menu: the selected blocks become a new synced block, and this page
 * holds its source in their place.
 */
export async function turnIntoSyncedBlock(
  editor: BlockNoteEditor<never, never, never>,
  selection: EditorBlock[],
  handlers: EditorSemanticHandlers,
): Promise<boolean> {
  const synced = handlers.synced;
  const first = selection[0];
  if (!synced || !first?.id) return false;
  const blockId = crypto.randomUUID();
  const id = await synced.create(blockId, { version: CONTENT_VERSION, blocks: selection }).catch(() => null);
  if (!id) return false;
  editor.insertBlocks([{ id: blockId, type: "syncedBlock", props: { syncedBlockId: id, role: "source" } } as never], first.id, "before");
  editor.removeBlocks(selection.flatMap((block) => (block.id ? [block.id] : [])));
  return true;
}

type Loaded =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "access"; access: SyncedAccessState }
  | { state: "ready"; block: SyncedBlockView };

function SyncedBlock({
  id,
  role,
  blockId,
  editable,
  onChoose,
  t,
  handlers,
}: {
  id: string;
  role: Role;
  blockId: string;
  editable: boolean;
  onChoose: (id: string, role: Role) => void;
  t: EditorT;
  handlers: HandlersBox;
}) {
  const api = handlers.current?.synced;
  if (!api) {
    return (
      <p role="note" className="w-full rounded-(--radius-sm) border border-line p-2 text-body-sm text-muted">
        {t("semantic.unavailable")}
      </p>
    );
  }
  if (!id) {
    return editable ? <SyncedPicker blockId={blockId} onChoose={onChoose} t={t} handlers={handlers} /> : <span />;
  }
  return <SyncedContent key={id} id={id} role={role} editable={editable} t={t} handlers={handlers} />;
}

function SyncedPicker({
  blockId,
  onChoose,
  t,
  handlers,
}: {
  blockId: string;
  onChoose: (id: string, role: Role) => void;
  t: EditorT;
  handlers: HandlersBox;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<{ id: string; preview: string; sourceTitle: string }[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const inputId = React.useId();

  React.useEffect(() => {
    const api = handlers.current?.synced;
    if (!api) return;
    let active = true;
    const timer = setTimeout(() => {
      void api
        .list(query)
        .then((rows) => active && setResults(rows))
        .catch(() => active && setResults([]));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [handlers, query]);

  return (
    <div className="w-full rounded-(--radius-sm) border border-dashed border-line p-3" contentEditable={false} onKeyDown={isolateKeys}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={async () => {
          const api = handlers.current?.synced;
          if (!api) return;
          setBusy(true);
          setError(false);
          const created = await api.create(blockId, emptyContent()).catch(() => null);
          setBusy(false);
          if (created) onChoose(created, "source");
          else setError(true);
        }}
      >
        <Plus className="size-4" aria-hidden />
        {t("syncedBlock.newBlock")}
      </Button>
      <label htmlFor={inputId} className="mb-1 mt-3 flex items-center gap-1.5 text-caption font-medium text-ink">
        <Search className="size-3.5" aria-hidden />
        {t("syncedBlock.search")}
      </label>
      <Input id={inputId} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
      <ul className="mt-2 flex flex-col gap-1" aria-live="polite">
        {results === null ? (
          <li className="text-caption text-muted">{t("semantic.picker.searching")}</li>
        ) : results.length === 0 ? (
          <li className="text-caption text-muted">{t("syncedBlock.noResults")}</li>
        ) : (
          results.map((row) => (
            <li key={row.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full flex-col items-start py-1"
                aria-label={t("syncedBlock.choose", { preview: row.preview || t("syncedBlock.empty") })}
                onClick={() => onChoose(row.id, "copy")}
              >
                <span className="truncate text-ink">{row.preview || t("syncedBlock.empty")}</span>
                <span className="text-caption text-muted">{t("syncedBlock.fromPage", { title: row.sourceTitle })}</span>
              </Button>
            </li>
          ))
        )}
      </ul>
      {error ? <p className="mt-1 text-caption text-danger-fg">{t("semantic.failed")}</p> : null}
    </div>
  );
}

function SyncedContent({
  id,
  role,
  editable,
  t,
  handlers,
}: {
  id: string;
  role: Role;
  editable: boolean;
  t: EditorT;
  handlers: HandlersBox;
}) {
  const [loaded, setLoaded] = React.useState<Loaded>({ state: "loading" });
  const [reloads, setReloads] = React.useState(0);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    const api = handlers.current?.synced;
    if (!api) return;
    let active = true;
    void api
      .load(id)
      .then((result) => {
        if (!active) return;
        if (!result) setLoaded({ state: "failed" });
        else if (result.ok) setLoaded({ state: "ready", block: result.block });
        else setLoaded({ state: "access", access: result.access });
      })
      .catch(() => active && setLoaded({ state: "failed" }));
    return () => {
      active = false;
    };
  }, [handlers, id, reloads]);

  // The content is shown by a nested, read-only editor that has no synced
  // blocks of its own, so a copy can never show itself.
  const nested = React.useMemo<EditorSemanticHandlers | undefined>(() => {
    const current = handlers.current;
    return current ? { ...current, synced: undefined } : undefined;
  }, [handlers]);

  const box = "w-full rounded-(--radius-sm) border border-brand/40 bg-surface p-2.5";

  if (loaded.state === "loading") {
    return (
      <p className="text-body-sm text-muted" contentEditable={false}>
        {t("syncedBlock.loading")}
      </p>
    );
  }
  if (loaded.state === "failed") {
    return (
      <p role="note" className={box} contentEditable={false}>
        {t("semantic.unavailable")}
      </p>
    );
  }
  if (loaded.state === "access") {
    return <AccessRequest id={id} access={loaded.access} t={t} handlers={handlers} />;
  }

  const { block } = loaded;
  const isSource = role === "source";
  const blank = block.content.blocks.every((item) => !item.content?.length && !item.children?.length && item.type === "paragraph");
  return (
    <section
      className={box}
      contentEditable={false}
      onKeyDown={isolateKeys}
      aria-label={t("syncedBlock.label")}
      data-synced-role={role}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone="info">
          <Repeat2 className="mr-1 size-3" aria-hidden />
          {t("syncedBlock.badge")}
        </Badge>
        {isSource ? (
          <span className="text-caption text-muted">
            {block.pageCount === 1 ? t("syncedBlock.shownOnOne") : t("syncedBlock.shownOn", { count: String(block.pageCount) })}
          </span>
        ) : null}
        {isSource && editable && block.canEdit ? (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
            {t("syncedBlock.edit")}
          </Button>
        ) : null}
      </div>
      {blank ? (
        <p className="text-body-sm text-muted">{t("syncedBlock.empty")}</p>
      ) : (
        <BlockEditor
          key={reloads}
          initialContent={block.content}
          editable={false}
          semantic={nested}
          label={t("syncedBlock.contentLabel")}
        />
      )}
      {isSource && block.canEdit && block.requests.length > 0 ? (
        <AccessRequests id={id} requests={block.requests} t={t} handlers={handlers} onDecided={() => setReloads((n) => n + 1)} />
      ) : null}
      {editing
        ? createPortal(
            <EditDialog
              id={id}
              content={block.content}
              nested={nested}
              t={t}
              handlers={handlers}
              onClose={(saved) => {
                setEditing(false);
                if (saved) setReloads((n) => n + 1);
              }}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

function EditDialog({
  id,
  content,
  nested,
  t,
  handlers,
  onClose,
}: {
  id: string;
  content: EditorContent;
  nested: EditorSemanticHandlers | undefined;
  t: EditorT;
  handlers: HandlersBox;
  onClose: (saved: boolean) => void;
}) {
  const latest = React.useRef<EditorContent>(content);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const hintId = React.useId();
  return (
    <Dialog open onClose={() => onClose(false)} title={t("syncedBlock.edit")} className="max-w-2xl">
      <p id={hintId} className="mb-2 text-caption text-muted">
        {t("syncedBlock.editHint")}
      </p>
      <div className="max-h-[60vh] overflow-y-auto rounded-(--radius-sm) border border-line p-2">
        <BlockEditor
          initialContent={content}
          editable
          onChange={(next) => {
            latest.current = next;
          }}
          semantic={nested}
          hintId={hintId}
          label={t("syncedBlock.contentLabel")}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-caption text-danger-fg">
          {t("semantic.failed")}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => onClose(false)}>
          {t("syncedBlock.cancel")}
        </Button>
        <Button
          loading={busy}
          onClick={async () => {
            const api = handlers.current?.synced;
            if (!api) return;
            setBusy(true);
            setError(false);
            const ok = await api.update(id, latest.current).catch(() => false);
            setBusy(false);
            if (ok) onClose(true);
            else setError(true);
          }}
        >
          {t("syncedBlock.save")}
        </Button>
      </div>
    </Dialog>
  );
}

function AccessRequest({
  id,
  access,
  t,
  handlers,
}: {
  id: string;
  access: SyncedAccessState;
  t: EditorT;
  handlers: HandlersBox;
}) {
  const [state, setState] = React.useState<SyncedAccessState>(access);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  return (
    <div
      className="w-full rounded-(--radius-sm) border border-dashed border-line p-3"
      contentEditable={false}
      onKeyDown={isolateKeys}
      data-testid="synced-access"
    >
      <p className="flex items-center gap-2 text-body-sm text-ink">
        <Repeat2 className="size-4 shrink-0 text-muted" aria-hidden />
        {t("syncedBlock.noAccess")}
      </p>
      <div className="mt-2" role="status">
        {state === "requested" ? (
          <p className="text-caption text-muted">{t("syncedBlock.requested")}</p>
        ) : state === "declined" ? (
          <p className="text-caption text-muted">{t("syncedBlock.declined")}</p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={async () => {
              const api = handlers.current?.synced;
              if (!api) return;
              setBusy(true);
              setError(false);
              const ok = await api.requestAccess(id).catch(() => false);
              setBusy(false);
              if (ok) setState("requested");
              else setError(true);
            }}
          >
            {t("syncedBlock.requestAccess")}
          </Button>
        )}
        {error ? <p className="mt-1 text-caption text-danger-fg">{t("semantic.failed")}</p> : null}
      </div>
    </div>
  );
}

function AccessRequests({
  id,
  requests,
  t,
  handlers,
  onDecided,
}: {
  id: string;
  requests: SyncedBlockView["requests"];
  t: EditorT;
  handlers: HandlersBox;
  onDecided: () => void;
}) {
  const headingId = React.useId();
  const decide = async (requesterId: string, grant: boolean) => {
    const ok = await handlers.current?.synced?.decideAccess(id, requesterId, grant).catch(() => false);
    if (ok) onDecided();
  };
  return (
    <section className="mt-2 border-t border-line pt-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-caption font-medium text-ink">
        {t("syncedBlock.requestsTitle")}
      </h3>
      <ul className="mt-1 flex flex-col gap-1">
        {requests.map((request) => (
          <li key={request.requesterId} className="flex flex-wrap items-center gap-2 text-body-sm">
            <span className="min-w-0 flex-1 truncate text-ink">{request.name}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => void decide(request.requesterId, true)}>
              {t("syncedBlock.grant", { name: request.name })}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void decide(request.requesterId, false)}>
              {t("syncedBlock.decline", { name: request.name })}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
