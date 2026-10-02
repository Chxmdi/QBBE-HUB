"use client";

import * as React from "react";
import { BlockEditor } from "@/features/editor/adapter/block-editor";
import { CONTENT_VERSION, type EditorBlock, type EditorContent } from "@/features/editor/adapter/content";
import { useTemplateEditorHandlers } from "./template-editor-handlers";

/**
 * A template's page in the real editor, read-only (T1-3): the same blocks,
 * renderers and styles a page made from it will have. The editor reads its
 * content once, so a change of start date, language or values mounts it
 * again (deferred, so typing a value stays responsive).
 */
export function TemplatePreview({ blocks, label }: { blocks: EditorBlock[]; label: string }) {
  const semantic = useTemplateEditorHandlers();
  const deferred = React.useDeferredValue(blocks);
  const key = React.useMemo(() => JSON.stringify(deferred), [deferred]);
  const content = React.useMemo<EditorContent>(() => ({ version: CONTENT_VERSION, blocks: deferred }), [deferred]);
  return (
    <div data-testid="template-preview" className="min-w-0">
      <BlockEditor key={key} initialContent={content} editable={false} semantic={semantic} label={label} />
    </div>
  );
}
