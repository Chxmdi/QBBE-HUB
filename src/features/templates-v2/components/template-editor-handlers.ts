"use client";

import * as React from "react";
import type { EditorSemanticHandlers } from "@/features/editor/adapter/types";
import { documentRef } from "@/features/editor/adapter/files";
import { resolveEditorFile } from "@/features/editor/services/editor-document.commands";
import {
  listPeople,
  listTaskProjects,
  runQueryBlock,
  searchObjects,
  summarizeObjects,
} from "@/features/editor/services/semantic.commands";

/**
 * The editor's data for a template (T1): blocks read and search what the
 * reader may open, as on a page, but a template never creates or changes a
 * real record. A task written in a template is made when the template is
 * used (its hub), not while it is edited.
 */
export function useTemplateEditorHandlers(): EditorSemanticHandlers {
  return React.useMemo<EditorSemanticHandlers>(
    () => ({
      summarize: (refs) => summarizeObjects(refs),
      search: (kind, query) => searchObjects(kind, query),
      projects: () => listTaskProjects(),
      people: () => listPeople(),
      createTask: async () => null,
      setTaskDone: async () => false,
      runQuery: async (spec) => {
        const result = await runQueryBlock(spec);
        return result.ok ? result.rows : null;
      },
      openFile: (documentId) => resolveEditorFile(documentRef(documentId)),
    }),
    [],
  );
}
