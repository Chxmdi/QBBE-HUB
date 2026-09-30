"use client";

import * as React from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useEditorT } from "@/features/editor/i18n/client";
import { BlockEditor, type EditorFileHandlers } from "@/features/editor/adapter/block-editor";
import type { EditorContent } from "@/features/editor/adapter/content";
import { documentIdFromRef, MAX_UPLOAD_BYTES, storagePathFor } from "@/features/editor/adapter/files";
import { registerEditorUpload, resolveEditorFile, saveEditorDocument } from "@/features/editor/services/editor-document.commands";

type SaveState = "idle" | "saving" | "saved" | "failed" | "offline" | "conflict" | "forbidden" | "tooLarge";

const SAVE_DELAY_MS = 800;
const RETRY_MS = 5000;
/** Next.js caps a server action's request at 1 MB; stay under it with room for the envelope. */
const MAX_SAVE_CHARS = 950_000;

/**
 * The body of a page (or, from M4d, a task): the block editor with autosave.
 * Saves are debounced and strictly one at a time, each carrying the version
 * it was based on, so a save from another window is detected instead of
 * overwritten. Until live co-editing (V1-17) that is reported, not merged.
 */
export function ObjectEditor({
  objectId,
  objectType,
  initialContent,
  initialState = null,
  initialVersion,
  editable,
  label,
}: {
  objectId: string;
  objectType: "page" | "task";
  initialContent: EditorContent;
  initialState?: string | null;
  initialVersion: number | null;
  editable: boolean;
  /** Accessible name for the editor; defaults to "Document content". */
  label?: string;
}) {
  const t = useEditorT();
  const hintId = React.useId();
  const [state, setState] = React.useState<SaveState>("idle");
  const version = React.useRef<number | null>(initialVersion);
  const pending = React.useRef<{ content: EditorContent; state: string } | null>(null);
  const saving = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = React.useRef(false);
  // Lets a save schedule the next one without the callback naming itself.
  const again = React.useRef<() => void>(() => {});

  const flush = React.useCallback(async () => {
    if (saving.current || stopped.current || !pending.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState("offline");
      return;
    }
    const next = pending.current;
    if (JSON.stringify(next.content).length + next.state.length > MAX_SAVE_CHARS) {
      // Kept pending: a later, smaller version of the document can still save.
      setState("tooLarge");
      return;
    }
    pending.current = null;
    saving.current = true;
    setState("saving");
    let result: Awaited<ReturnType<typeof saveEditorDocument>>;
    try {
      result = await saveEditorDocument({
        objectId,
        objectType,
        baseVersion: version.current,
        content: next.content,
        state: next.state,
      });
    } catch {
      result = { ok: false, reason: "failed" };
    }
    saving.current = false;
    if (result.ok) {
      version.current = result.version;
      setState(pending.current ? "saving" : "saved");
      if (pending.current) again.current();
      return;
    }
    if (result.reason === "conflict" || result.reason === "forbidden") {
      stopped.current = true;
      setState(result.reason);
      return;
    }
    // Keep the newest content and try again shortly.
    pending.current = pending.current ?? next;
    setState("failed");
    timer.current = setTimeout(() => again.current(), RETRY_MS);
  }, [objectId, objectType]);

  React.useEffect(() => {
    again.current = () => void flush();
  }, [flush]);

  React.useEffect(() => {
    const online = () => void flush();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current || saving.current) event.preventDefault();
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  const onChange = React.useCallback(
    (content: EditorContent, state: string) => {
      if (stopped.current) return;
      pending.current = { content, state };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
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

  const message: Record<SaveState, string | null> = {
    idle: null,
    saving: t("save.saving"),
    saved: t("save.saved"),
    failed: t("save.failed"),
    offline: t("save.offline"),
    conflict: t("save.conflict"),
    forbidden: t("save.forbidden"),
    tooLarge: t("save.tooLarge"),
  };
  const alert = state === "conflict" || state === "forbidden" || state === "tooLarge";

  return (
    <div>
      {editable ? (
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <p id={hintId} className="text-caption text-muted">
            {t("keyboardHint")}
          </p>
          <p
            role={alert ? "alert" : "status"}
            data-testid="editor-save-state"
            className={cn("text-caption", alert ? "text-danger-fg" : "text-muted")}
          >
            {message[state]}
          </p>
        </div>
      ) : null}
      <BlockEditor
        initialContent={initialContent}
        initialState={initialState}
        editable={editable && state !== "conflict" && state !== "forbidden"}
        onChange={editable ? onChange : undefined}
        files={files}
        hintId={editable ? hintId : undefined}
        label={label}
      />
    </div>
  );
}
