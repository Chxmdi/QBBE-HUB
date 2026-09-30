"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Label, Textarea } from "@/components/ui/input";
import type { MeetingNotesEditorProps } from "../editor-adapter";
import { useMeetingsV2T } from "./use-mv2-t";

/**
 * Stand-in for the block editor's meeting-notes binding (see
 * ../editor-adapter.ts). Plain text, with `/task`-style lines standing in for
 * semantic blocks; the block editor replaces this component, not its callers.
 */
export function PlaceholderNotesEditor({ initialContent, readOnly, onSave }: MeetingNotesEditorProps) {
  const t = useMeetingsV2T();
  const router = useRouter();
  const id = useId();
  const [notes, setNotes] = useState(initialContent);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "done" | "error"; text?: string }>({ kind: "idle" });

  if (readOnly) {
    return (
      <div className="card space-y-2 p-4">
        <p className="whitespace-pre-wrap text-sm text-ink">{initialContent || t("notes.empty")}</p>
        <p className="text-[12.5px] text-muted">{t("notes.readOnly")}</p>
      </div>
    );
  }

  async function save() {
    setState({ kind: "saving" });
    const result = await onSave(notes);
    if (!result.ok) {
      setState({ kind: "error", text: t("notes.error") });
      return;
    }
    setNotes(result.content);
    setState({
      kind: "done",
      text: result.captured > 0 ? t("notes.savedWithCaptures", { count: result.captured }) : t("notes.saved"),
    });
    router.refresh();
  }

  return (
    <div className="card space-y-3 p-4">
      <div>
        <Label htmlFor={id}>{t("notes.label")}</Label>
        <Textarea
          id={id}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          maxLength={20000}
          aria-describedby={`${id}-hint`}
        />
        <div id={`${id}-hint`}>
          <FieldHint>{t("notes.hint")}</FieldHint>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {state.kind === "done" ? (
          <span role="status" className="text-[12.5px] text-success-fg">{state.text}</span>
        ) : state.kind === "error" ? (
          <span role="alert" className="text-[12.5px] text-danger-fg">{state.text}</span>
        ) : null}
        <Button variant="secondary" size="sm" onClick={save} loading={state.kind === "saving"}>
          {t("notes.save")}
        </Button>
      </div>
    </div>
  );
}
