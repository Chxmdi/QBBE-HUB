"use client";

import * as React from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useEditorT } from "@/features/editor/i18n/client";
import { BlockEditor, type EditorFileHandlers } from "@/features/editor/adapter/block-editor";
import type { EditorSemanticHandlers } from "@/features/editor/adapter/types";
import { documentRef } from "@/features/editor/adapter/files";
import { removedTaskIds, taskBlockIds } from "@/features/editor/semantic/removed";
import {
  archiveTaskFromBlock,
  createTaskFromBlock,
  listPeople,
  listTaskProjects,
  turnIntoPage,
  runQueryBlock,
  searchObjects,
  setTaskDone,
  summarizeObjects,
} from "@/features/editor/services/semantic.commands";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/input";
import { calendarDateInZone, DEFAULT_TIME_ZONE } from "@/lib/time";
import type { TaskSuggestionOptions } from "@/features/editor/adapter/types";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { EditorContent } from "@/features/editor/adapter/content";
import { documentIdFromRef, MAX_UPLOAD_BYTES, storagePathFor } from "@/features/editor/adapter/files";
<<<<<<< HEAD
import { registerEditorUpload, resolveEditorFile } from "@/features/editor/services/editor-document.commands";
import {
  appendEditorOperations,
  loadServerEditorDocument,
  type ServerEditorDocument,
} from "@/features/editor/services/editor-operations.commands";
import { useSaveQueue } from "@/features/editor/queue/use-save-queue";
import type { QueueBatch, QueueStatus, SendOutcome } from "@/features/editor/queue/queue";
import { ConflictDialog } from "./conflict-dialog";
=======
import { registerEditorUpload, resolveEditorFile, saveEditorDocument } from "@/features/editor/services/editor-document.commands";
import { blockTaskSource, type EditorObjectType } from "@/features/editor/semantic/source";
>>>>>>> origin/main

/** A task block cut and pasted elsewhere reappears within this time; only then is it "removed". */
const REMOVAL_GRACE_MS = 1500;
/** Each person's choice to hide "Make a task" suggestions, kept in this browser. */
const SUGGESTIONS_KEY = "qbbe-editor-task-suggestions";

const settingListeners = new Set<() => void>();

function readSuggestionsSetting(): boolean {
  try {
    return window.localStorage.getItem(SUGGESTIONS_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeSuggestionsSetting(on: boolean) {
  try {
    window.localStorage.setItem(SUGGESTIONS_KEY, on ? "on" : "off");
  } catch {
    // Private windows may refuse storage; the switch still works for this page.
    memorySetting = on;
  }
  settingListeners.forEach((listener) => listener());
}

let memorySetting: boolean | null = null;

function subscribeSuggestionsSetting(listener: () => void) {
  settingListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    settingListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Each person's choice, kept in this browser; on by default and during the server render. */
function useSuggestionsSetting(): boolean {
  return React.useSyncExternalStore(
    subscribeSuggestionsSetting,
    () => memorySetting ?? readSuggestionsSetting(),
    () => true,
  );
}

/**
<<<<<<< HEAD
 * The body of a page (or, from M4d, a task): the block editor with autosave
 * through the operation queue (U3). Edits become operations, batched and sent
 * one request at a time with the version they were based on, kept on the
 * device until the server confirms them. A save from another window is a
 * conflict the person resolves (keep mine, take theirs, review), not an
 * overwrite. Until live co-editing (V1-17) nothing is merged.
=======
 * The body of a page (from M4d a task, and a meeting's notes): the block
 * editor with autosave.
 * Saves are debounced and strictly one at a time, each carrying the version
 * it was based on, so a save from another window is detected instead of
 * overwritten. Until live co-editing (V1-17) that is reported, not merged.
>>>>>>> origin/main
 */
export function ObjectEditor({
  objectId,
  objectType,
  initialContent,
  initialState = null,
  initialVersion,
  editable,
  label,
  timeZone = DEFAULT_TIME_ZONE,
  defaultProjectId = null,
}: {
  objectId: string;
  objectType: EditorObjectType;
  initialContent: EditorContent;
  initialState?: string | null;
  initialVersion: number | null;
  editable: boolean;
  /** Accessible name for the editor; defaults to "Document content". */
  label?: string;
  /** The organization's zone, for resolving "tomorrow" in suggestions. */
  timeZone?: string;
  /** The project offered first for a task made here (a meeting's project). */
  defaultProjectId?: string | null;
}) {
  const t = useEditorT();
  const hintId = React.useId();
  const { toast } = useToast();
  const latest = React.useRef<EditorContent>(initialContent);
  const [removal, setRemoval] = React.useState<{ id: string; title: string } | null>(null);
  const suggestionsOn = useSuggestionsSetting();
  const [people, setPeople] = React.useState<{ id: string; name: string }[]>([]);
  const suggestionsId = React.useId();
  // The conflict the person closed without choosing; the pill offers to reopen it.
  const [dismissed, setDismissed] = React.useState(0);
  const [theirs, setTheirs] = React.useState<{ id: number; doc: ServerEditorDocument | null } | null>(null);

  React.useEffect(() => {
    if (!editable || !suggestionsOn) return;
    let active = true;
    void listPeople()
      .then((rows) => active && setPeople(rows))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [editable, suggestionsOn]);

  const send = React.useCallback(
    async (batch: QueueBatch): Promise<SendOutcome> => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, reason: "offline" };
      try {
        const result = await appendEditorOperations({
          objectId,
          objectType,
          baseVersion: batch.baseVersion,
          ops: batch.ops.map((op) => ({ kind: "replace" as const, content: op.content, state: op.state })),
        });
        if (result.ok) return { ok: true, version: result.version };
        if (result.reason === "conflict") return { ok: false, reason: "conflict", version: result.version ?? null };
        if (result.reason === "forbidden" || result.reason === "tooLarge") return { ok: false, reason: result.reason };
        return { ok: false, reason: "failed" };
      } catch {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        return { ok: false, reason: offline ? "offline" : "failed" };
      }
    },
    [objectId, objectType],
  );

  const queue = useSaveQueue({ objectId, initialVersion, initialContent, initialState, send, enabled: editable });
  const { status, conflict, seed } = queue;
  const conflictOpen = conflict !== null && conflict.id !== dismissed;
  const theirsDoc = conflict && theirs?.id === conflict.id ? theirs.doc : undefined;

  // The editor was mounted again on other content: an unsaved edit kept on
  // this device, or the other person's version.
  const toastedSeed = React.useRef(0);
  React.useEffect(() => {
    latest.current = seed.content;
    if (seed.reason === "restored" && toastedSeed.current !== seed.key) {
      toastedSeed.current = seed.key;
      toast(t("save.restored"), { tone: "info" });
    }
  }, [seed, toast, t]);

  // A conflict loads the other version, for "take theirs" and the review.
  React.useEffect(() => {
    if (!conflict) return;
    let active = true;
    const { id } = conflict;
    loadServerEditorDocument(objectId)
      .then((doc) => active && setTheirs({ id, doc }))
      .catch(() => active && setTheirs({ id, doc: null }));
    return () => {
      active = false;
    };
  }, [conflict, objectId]);

  const { takeTheirs: takeTheirsFromQueue, latest: latestQueued, enqueue } = queue;
  const takeTheirs = React.useCallback(() => {
    if (!theirsDoc) return;
    takeTheirsFromQueue(theirsDoc);
  }, [takeTheirsFromQueue, theirsDoc]);

  const mine = React.useCallback(() => latestQueued()?.content ?? latest.current, [latestQueued]);

  const onChange = React.useCallback(
    (content: EditorContent, state: string) => {
      const removed = removedTaskIds(latest.current, content);
      latest.current = content;
      if (removed.length > 0) {
        setTimeout(() => {
          // Still gone after the grace period: ask about the first one.
          const present = taskBlockIds(latest.current);
          const id = removed.find((taskId) => !present.has(taskId));
          if (!id) return;
          void summarizeObjects([{ kind: "task", id }]).then((rows) => {
            const task = rows[0];
            if (task && !task.archived) setRemoval({ id, title: task.title });
          });
        }, REMOVAL_GRACE_MS);
      }
      enqueue(content, state);
    },
    [enqueue],
  );

  const files = React.useMemo<EditorFileHandlers>(
    () => ({
      upload: async (file) => {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(t("files.tooLarge"));
        const supabase = createSupabaseBrowserClient();
        const path = storagePathFor(file.name, crypto.randomUUID());
        const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
        if (error) throw new Error(t("files.uploadFailed"));
        const result = await registerEditorUpload({
          storagePath: path,
          fileName: file.name.slice(0, 200) || "file",
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        });
        if (!result.ok) {
          await supabase.storage.from("documents").remove([path]);
          throw new Error(result.error);
        }
        return result.ref;
      },
      resolve: async (ref) => {
        if (!documentIdFromRef(ref)) return /^https:\/\//i.test(ref) ? ref : null;
        return resolveEditorFile(ref);
      },
    }),
    [t],
  );

  const semantic = React.useMemo<EditorSemanticHandlers>(
    () => ({
      summarize: (refs) => summarizeObjects(refs),
      search: (kind, query) => searchObjects(kind, query),
      projects: () => listTaskProjects(),
      defaultProjectId,
      people: () => listPeople(),
      requireOwnerAndDue: objectType === "meeting",
      createTask: async (title, projectId, extras) => {
        // The task records the page or meeting it was written in (M7b).
        const result = await createTaskFromBlock(title, projectId ?? undefined, extras, blockTaskSource(objectType, objectId));
        return result.ok ? result.task : null;
      },
      setTaskDone: async (taskId, done) => (await setTaskDone(taskId, done)).ok,
      runQuery: async (spec) => {
        const result = await runQueryBlock(spec);
        return result.ok ? result.rows : null;
      },
      openFile: (documentId) => resolveEditorFile(documentRef(documentId)),
      turnIntoPage:
        objectType === "page"
          ? async (title, content) => {
              const result = await turnIntoPage({ parentPageId: objectId, title, content });
              return result.ok ? result.page : null;
            }
          : undefined,
    }),
    [objectId, objectType, defaultProjectId],
  );

  const taskSuggestions = React.useMemo<TaskSuggestionOptions>(
    () => ({
      enabled: suggestionsOn && people.length > 0,
      people,
      today: calendarDateInZone(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10),
    }),
    [suggestionsOn, people, timeZone],
  );

  const message: Record<QueueStatus, string | null> = {
    idle: null,
    saving: t("save.saving"),
    saved: t("save.saved"),
    failed: t("save.failed"),
    offline: t("save.offline"),
    conflict: t("save.conflict"),
    forbidden: t("save.forbidden"),
    tooLarge: t("save.tooLarge"),
  };
  const alert = status === "conflict" || status === "forbidden" || status === "tooLarge";

  return (
    <div>
      {editable ? (
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <p id={hintId} className="text-caption text-muted">
            {t("keyboardHint")}
          </p>
          <label htmlFor={suggestionsId} className="flex min-h-6 items-center gap-2 text-caption text-ink" title={t("progressive.toggleHint")}>
            <Switch
              id={suggestionsId}
              checked={suggestionsOn}
              onChange={(event) => writeSuggestionsSetting(event.target.checked)}
            />
            {t("progressive.toggle")}
          </label>
          <div className="flex items-center gap-2">
            <p
              role={alert ? "alert" : "status"}
              data-testid="editor-save-state"
              data-save-status={status}
              className={cn("text-caption", alert ? "text-danger-fg" : "text-muted")}
            >
              {message[status]}
            </p>
            {conflict && !conflictOpen ? (
              <Button size="sm" variant="secondary" onClick={() => setDismissed(0)}>
                {t("conflictDialog.open")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <BlockEditor
        key={seed.key}
        initialContent={seed.content}
        initialState={seed.state}
        editable={editable && status !== "forbidden"}
        onChange={editable ? onChange : undefined}
        files={files}
        semantic={semantic}
        taskSuggestions={taskSuggestions}
        hintId={editable ? hintId : undefined}
        label={label}
      />
      {conflict ? (
        <ConflictDialog
          key={conflict.id}
          open={conflictOpen}
          mine={mine}
          theirs={theirsDoc === undefined ? undefined : (theirsDoc?.content ?? null)}
          onKeepMine={queue.keepMine}
          onTakeTheirs={takeTheirs}
          onClose={() => setDismissed(conflict.id)}
        />
      ) : null}
      {removal ? (
        <Dialog open onClose={() => setRemoval(null)} title={t("semantic.removed.title")}>
          <p className="text-body-sm text-ink">{t("semantic.removed.body", { title: removal.title })}</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoval(null)}>
              {t("semantic.removed.keep")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const result = await archiveTaskFromBlock(removal.id);
                setRemoval(null);
                toast(result.ok ? t("semantic.removed.archived") : (result.error ?? t("semantic.failed")), {
                  tone: result.ok ? "success" : "error",
                });
              }}
            >
              {t("semantic.removed.archive")}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
