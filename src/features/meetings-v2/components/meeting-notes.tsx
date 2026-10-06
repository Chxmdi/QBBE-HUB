"use client";

import { saveNotesWithCaptures } from "../services/meeting-v2.commands";
import { PlaceholderNotesEditor } from "./placeholder-notes-editor";
import type { MeetingNotesEditor } from "../editor-adapter";

/**
 * The plain-text fallback while the `wos_editor` switch is off. With it on,
 * the meeting page mounts the block editor (ObjectEditor, objectType
 * "meeting") instead, and this component is not rendered.
 */
const Editor: MeetingNotesEditor = PlaceholderNotesEditor;

export function MeetingNotes({
  meetingId,
  initialContent,
  readOnly,
}: {
  meetingId: string;
  initialContent: string;
  readOnly: boolean;
}) {
  return (
    <Editor
      meetingId={meetingId}
      initialContent={initialContent}
      readOnly={readOnly}
      onSave={async (content) => {
        const result = await saveNotesWithCaptures({ meetingId, notes: content });
        return { ok: result.ok, captured: result.captured ?? 0, content: result.notes ?? content };
      }}
    />
  );
}
