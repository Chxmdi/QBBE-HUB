import type { ActionDefinition, Change, Uuid } from "@/lib/objects/contracts";

/**
 * `object.import` (Workspace OS U15): many records from one CSV as ONE change
 * set, so "Undo" takes the whole import back at once.
 *
 * Each row goes through the type's shared create path (createUniversalTask
 * for tasks, the createProject command for projects), so an imported record
 * is exactly what the form would have made. The registry checks the import's capability once; this action
 * then checks the create action's capability on each row's targets itself,
 * so one row the person may not add (a project they cannot edit) is skipped
 * and reported rather than refusing the whole file.
 *
 * Rows that fail are reported through `report`; the change set carries only
 * what was created.
 */

export const IMPORT_ACTION = "object.import";
export const IMPORT_ROW_LIMIT = 2000;

export type ImportTypeKey = "task" | "project";
export type ImportFailure = "forbidden" | "invalid" | "failed";

export interface ImportRow {
  /** The file's data row, for the report. */
  row: number;
  input: unknown;
}

export interface ImportInput {
  typeKey: ImportTypeKey;
  rows: ImportRow[];
  report?: (row: number, failure: ImportFailure, detail: string | null) => void;
}

export function importTargets(input: ImportInput): Uuid[] {
  if (input.typeKey !== "task" && input.typeKey !== "project") throw new Error("Unknown type.");
  if (!Array.isArray(input.rows) || input.rows.length === 0) throw new Error("Nothing to import.");
  if (input.rows.length > IMPORT_ROW_LIMIT) throw new Error(`An import is limited to ${IMPORT_ROW_LIMIT} rows.`);
  return [];
}

function classify(error: unknown): { failure: ImportFailure; detail: string | null } {
  const text = error instanceof Error ? error.message : String(error);
  return { failure: /invalid/i.test(text) ? "invalid" : "failed", detail: text || null };
}

/**
 * `runners` are the types' forward create actions (the shared task creation,
 * project.create). They are handed in rather than looked up by key because
 * the registered `task.create` only records creations made on the task's own
 * screens and does not run forward.
 */
export function createImportAction(
  // Each runner takes its own input type; rows carry already-built input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runners: Partial<Record<ImportTypeKey, ActionDefinition<any>>>,
): ActionDefinition<ImportInput> {
  return {
    key: IMPORT_ACTION,
    label: { en: "Import records", fr: "Importer des éléments" },
    capability: "edit_content",
    targets: importTargets,
    async run(context, input) {
      const action = runners[input.typeKey];
      if (!action) throw new Error(`No create action for ${input.typeKey}.`);
      const report = input.report ?? (() => {});
      const changes: Change[] = [];
      for (const row of input.rows) {
        let targets: Uuid[];
        try {
          targets = action.targets(row.input);
        } catch (error) {
          report(row.row, "invalid", error instanceof Error ? error.message : null);
          continue;
        }
        let allowed = true;
        for (const id of targets) {
          if (!(await context.can(id, action.capability))) {
            allowed = false;
            break;
          }
        }
        if (!allowed) {
          report(row.row, "forbidden", null);
          continue;
        }
        try {
          changes.push(...(await action.run(context, row.input)));
        } catch (error) {
          const { failure, detail } = classify(error);
          report(row.row, failure, detail);
        }
      }
      return changes;
    },
  };
}
