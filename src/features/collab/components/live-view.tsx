"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/client";
import type { ObjectRef } from "@/lib/objects/contracts";
import { ContentEditor } from "@/features/versions/components/content-editor";
import { collabText } from "../messages";
import type { SuggestionView } from "../services/suggestion.queries";
import { PresenceBar } from "./presence-bar";
import { SelectionActions, SuggestionList, type TextSelection } from "./suggestions-panel";
import { usePresence } from "./use-presence";

type Mode = "edit" | "suggest";

/**
 * The live screen's client part: presence and cursors around the editor
 * stand-in, with a suggesting mode where selected text can be commented on
 * or a change suggested. The block editor replaces ContentEditor and passes
 * its cursor and selection the same way.
 */
export function LiveView({
  object,
  me,
  canEdit,
  canSuggest,
  canComment,
  locked,
  blockId,
  initialText,
  suggestions,
}: {
  object: ObjectRef;
  me: string;
  canEdit: boolean;
  canSuggest: boolean;
  canComment: boolean;
  locked: boolean;
  blockId: string;
  initialText: string;
  suggestions: SuggestionView[];
}) {
  const m = collabText(useLocale());
  const editable = canEdit && !locked;
  const [mode, setMode] = useState<Mode>(editable ? "edit" : "suggest");
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const editing = editable && mode === "edit";
  const presence = usePresence(object.id, editing);
  const blockName = (id: string) => (m.page.blocks as Record<string, string>)[id] ?? id;
  const suggestHere = mode === "suggest" && !locked && (canSuggest || canComment);

  return (
    <>
      <PresenceBar entries={presence.entries} me={me} blockName={blockName} live={presence.live} />
      {editable && (canSuggest || canComment) ? (
        <fieldset className="mb-2 flex flex-wrap items-center gap-3 text-[13px]">
          <legend className="sr-only">{m.suggest.modeLabel}</legend>
          {(["edit", "suggest"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1">
              <input
                type="radio"
                name="live-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {value === "edit" ? m.suggest.editing : m.suggest.suggesting}
            </label>
          ))}
        </fieldset>
      ) : null}
      {suggestHere ? <p className="meta mb-2">{m.suggest.suggestingHint}</p> : null}
      <ContentEditor
        key={initialText}
        object={object}
        blockId={blockId}
        initialText={initialText}
        disabled={!editing && !suggestHere}
        readOnly={suggestHere}
        onCursor={(cursor) => {
          presence.moveCursor(cursor);
          // Leaving the text (to type the suggestion) keeps the last selection.
          if (!cursor) return;
          setSelection(cursor.length > 0 ? { blockId: cursor.blockId, start: cursor.offset, end: cursor.offset + cursor.length } : null);
        }}
      />
      {suggestHere ? (
        <SelectionActions
          object={object}
          text={initialText}
          selection={selection}
          canSuggest={canSuggest}
          canComment={canComment}
        />
      ) : null}
      <SuggestionList suggestions={suggestions} me={me} canDecide={editable} />
    </>
  );
}
