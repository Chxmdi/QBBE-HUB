"use client";

import { useId, useState } from "react";
import { useLocale } from "@/lib/i18n/client";
import type { ObjectRef } from "@/lib/objects/contracts";
import { versionsText } from "../messages";
import { autosaveObjectContent } from "../services/version.commands";
import type { ContentSnapshot } from "../content";
import { AutosaveStatus } from "./autosave-status";
import { useAutosave } from "./use-autosave";

/**
 * A plain-text stand-in for the block editor, so autosave and versions can be
 * used before stream S3's editor lands. The editor will call the same
 * `useAutosave` with its own content through its adapter.
 */
export function ContentEditor({
  object,
  initialText,
  blockId,
  disabled,
  readOnly,
  onCursor,
}: {
  object: ObjectRef;
  initialText: string;
  blockId: string;
  disabled?: boolean;
  /** Selectable but not editable, e.g. while suggesting (V1-17). */
  readOnly?: boolean;
  /** Where the caret or selection is, for presence (V1-17). */
  onCursor?: (cursor: { blockId: string; offset: number; length: number } | null) => void;
}) {
  const m = versionsText(useLocale()).editor;
  const [text, setText] = useState(initialText);
  const fieldId = useId();
  const hintId = useId();
  const autosave = useAutosave<string>(async (value) => {
    const content: ContentSnapshot = {
      version: 1,
      blocks: [{ id: blockId, type: "paragraph", text: value }],
    };
    const result = await autosaveObjectContent({ object, content });
    return result.ok;
  });

  function reportCursor(field: HTMLTextAreaElement) {
    onCursor?.({
      blockId,
      offset: field.selectionStart,
      length: field.selectionEnd - field.selectionStart,
    });
  }

  return (
    <section aria-labelledby={`${fieldId}-heading`} className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${fieldId}-heading`} className="section-heading">
          {m.heading}
        </h2>
        <AutosaveStatus status={autosave.status} savedAt={autosave.savedAt} />
      </div>
      <label htmlFor={fieldId} className="text-[13px] font-medium">
        {m.label}
      </label>
      <textarea
        id={fieldId}
        value={text}
        disabled={disabled}
        // Not the native readOnly: browsers stop keyboard selection inside a
        // read-only textarea, and selecting is the point of suggesting mode.
        aria-readonly={readOnly || undefined}
        onBeforeInput={(event) => {
          if (readOnly) event.preventDefault();
        }}
        onPaste={(event) => {
          if (readOnly) event.preventDefault();
        }}
        onCut={(event) => {
          if (readOnly) event.preventDefault();
        }}
        onDrop={(event) => {
          if (readOnly) event.preventDefault();
        }}
        aria-describedby={hintId}
        rows={8}
        maxLength={20000}
        onChange={(event) => {
          if (readOnly) return;
          setText(event.target.value);
          autosave.change(event.target.value);
        }}
        onBlur={() => {
          void autosave.flush();
          onCursor?.(null);
        }}
        onSelect={(event) => reportCursor(event.currentTarget)}
        onKeyUp={(event) => reportCursor(event.currentTarget)}
        onMouseUp={(event) => reportCursor(event.currentTarget)}
        className="mt-1 min-h-40 w-full rounded-(--radius-sm) border border-line bg-surface px-3 py-2 text-sm leading-normal text-ink focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p id={hintId} className="meta mt-1">
        {m.hint}
      </p>
    </section>
  );
}
