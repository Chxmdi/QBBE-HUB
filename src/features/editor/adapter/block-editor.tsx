"use client";

import dynamic from "next/dynamic";
import { useEditorT } from "@/features/editor/i18n/client";
import type { BlockEditorProps } from "./types";

/**
 * The block editor, loaded in the browser only: the editor library needs the
 * DOM, and keeping it out of the server render keeps it in its own chunk, so
 * pages without an editor do not pay for it. The implementation behind this
 * import is the only place that knows it is BlockNote.
 */
const Implementation = dynamic(() => import("./blocknote/editor"), {
  ssr: false,
  loading: () => <EditorLoading />,
});

function EditorLoading() {
  const t = useEditorT();
  return (
    <p role="status" className="px-1 py-3 text-body-sm text-muted">
      {t("loading")}
    </p>
  );
}

export function BlockEditor(props: BlockEditorProps) {
  return <Implementation {...props} />;
}

export type { BlockEditorProps, EditorFileHandlers } from "./types";
