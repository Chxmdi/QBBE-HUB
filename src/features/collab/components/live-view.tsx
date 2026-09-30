"use client";

import { useLocale } from "@/lib/i18n/client";
import type { ObjectRef } from "@/lib/objects/contracts";
import { ContentEditor } from "@/features/versions/components/content-editor";
import { collabText } from "../messages";
import { PresenceBar } from "./presence-bar";
import { usePresence } from "./use-presence";

/**
 * The live screen's client part: presence and cursors around the editor
 * stand-in. The block editor replaces ContentEditor and passes its cursor
 * to `moveCursor` the same way.
 */
export function LiveView({
  object,
  me,
  canEdit,
  locked,
  blockId,
  initialText,
}: {
  object: ObjectRef;
  me: string;
  canEdit: boolean;
  locked: boolean;
  blockId: string;
  initialText: string;
}) {
  const m = collabText(useLocale());
  const editing = canEdit && !locked;
  const presence = usePresence(object.id, editing);
  const blockName = (id: string) => (m.page.blocks as Record<string, string>)[id] ?? id;

  return (
    <>
      <PresenceBar entries={presence.entries} me={me} blockName={blockName} live={presence.live} />
      <ContentEditor
        object={object}
        blockId={blockId}
        initialText={initialText}
        disabled={!editing}
        onCursor={presence.moveCursor}
      />
    </>
  );
}
