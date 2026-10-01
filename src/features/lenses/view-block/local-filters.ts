import { z } from "zod";
import { viewConditionSchema, type ViewCondition } from "./schema";

/**
 * Page-local filters (U6): what one reader narrows a view block to, in this
 * browser tab only. They live in sessionStorage under the block's id and are
 * merged into the block's conditions when it runs. They never touch the
 * block's stored props or the saved lens, so a reader filtering a page
 * changes nothing for anyone else.
 */

export type LocalFilter = ViewCondition;

export const LOCAL_FILTERS_PREFIX = "qbbe-view-block-filters:";

export function localFiltersKey(blockId: string): string {
  return `${LOCAL_FILTERS_PREFIX}${blockId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const storedSchema = z.array(viewConditionSchema).max(20);

/** The reader's filters for a block; anything unreadable counts as none. */
export function readLocalFilters(storage: StorageLike | null | undefined, blockId: string): LocalFilter[] {
  if (!storage || !blockId) return [];
  try {
    const raw = storage.getItem(localFiltersKey(blockId));
    if (!raw) return [];
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Keeps the filters for this tab; no filters removes the entry. */
export function writeLocalFilters(storage: StorageLike | null | undefined, blockId: string, filters: LocalFilter[]): void {
  if (!storage || !blockId) return;
  try {
    if (filters.length === 0) storage.removeItem(localFiltersKey(blockId));
    else storage.setItem(localFiltersKey(blockId), JSON.stringify(filters));
  } catch {
    // Storage can be full or refused (private windows); the filters still apply on screen.
  }
}

/**
 * The block's conditions followed by the reader's, keeping only filters on
 * properties the block allows and one filter per property (the last wins).
 * Returns new arrays and never changes its inputs.
 */
export function mergeLocalFilters(
  where: readonly ViewCondition[],
  local: readonly LocalFilter[],
  allowedPaths: readonly string[],
): ViewCondition[] {
  const allowed = new Set(allowedPaths);
  const byPath = new Map<string, LocalFilter>();
  for (const filter of local) {
    if (allowed.has(filter.path)) byPath.set(filter.path, filter);
  }
  return [...where.map((c) => ({ ...c })), ...[...byPath.values()].map((c) => ({ ...c }))];
}

/** The filters with one property's filter replaced, or removed when `next` is null. */
export function setLocalFilter(filters: readonly LocalFilter[], path: string, next: LocalFilter | null): LocalFilter[] {
  const rest = filters.filter((f) => f.path !== path);
  return next ? [...rest, next] : rest;
}
