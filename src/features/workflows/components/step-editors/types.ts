import type { LensCatalog } from "@/lib/query/catalog";
import type { EditorStepKind } from "../../editor-model";
import type { WorkflowsMessages } from "../../i18n";

/** What every step editor needs besides its own step (U10). */
export interface StepEditorContext {
  catalog: LensCatalog;
  locale: string;
  /** The trigger's object types, for the property and record pickers. */
  objectTypes: readonly string[];
  /** Every step in the list, for "go to" choices. */
  steps: readonly { id: string; kind: EditorStepKind }[];
  /** Other workflows, for sub-workflow steps. */
  workflows: readonly { id: string; name: string }[];
  m: WorkflowsMessages;
}

export const hintClass = "mt-1 text-[12.5px] text-muted";
