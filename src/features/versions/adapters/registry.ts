import type { ObjectContentAdapter } from "../content";
import { taskContentAdapter } from "./task-adapter";

/**
 * Which adapter reads and writes each type's content. Integration adds the
 * block editor's adapter for pages (and every type with a document body) here.
 */
const ADAPTERS: Record<string, ObjectContentAdapter> = {
  task: taskContentAdapter,
};

export function contentAdapterFor(type: string): ObjectContentAdapter | null {
  return ADAPTERS[type] ?? null;
}
