import type { ObjectRef } from "@/lib/objects/contracts";

/**
 * What a version stores (M16a) and what compare and restore work on (M16b).
 *
 * Contract addition: the block editor (stream S3, M4c) produces this from its
 * live document through an ObjectContentAdapter, and applies it back. Blocks
 * carry the same ids as the derived `block` rows, so a comment on a block and
 * a block restored from a version agree on which block they mean. `yjsState`
 * holds the live document itself (base64 of Y.encodeStateAsUpdate) once
 * co-editing lands; restore prefers blocks, which survive a Yjs upgrade.
 */
export interface BlockSnapshot {
  id: string;
  type: string;
  /** Plain text of the block, used for search, compare and plain restores. */
  text: string;
  /** Anything else the editor needs to rebuild the block exactly. */
  props?: Record<string, unknown>;
}

export interface ContentSnapshot {
  version: 1;
  blocks: BlockSnapshot[];
  yjsState?: string;
}

/** Property values keyed by property key, as JSON. */
export type PropertySnapshot = Record<string, unknown>;

export interface ObjectSnapshot {
  content: ContentSnapshot;
  properties: PropertySnapshot;
}

export const emptyContent: ContentSnapshot = { version: 1, blocks: [] };

/**
 * Reads and writes one kind of object's content and properties, as the
 * signed-in person (so RLS and the object's own triggers still apply).
 */
export interface ObjectContentAdapter {
  /** Null when the object does not exist or the reader cannot see it. */
  read(object: ObjectRef): Promise<ObjectSnapshot | null>;
  /** The object's title, for the trash and version history. */
  title(object: ObjectRef): Promise<string | null>;
  /** Replaces the content, e.g. from autosave or a whole-object restore. */
  writeContent(object: ObjectRef, content: ContentSnapshot): Promise<void>;
  /** Sets some properties, leaving the rest as they are. */
  writeProperties(object: ObjectRef, properties: PropertySnapshot): Promise<void>;
  /** Which properties a restore may write; system fields such as created time are not among them. */
  restorableProperties: readonly string[];
}

export function isContentSnapshot(value: unknown): value is ContentSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ContentSnapshot>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.blocks) &&
    candidate.blocks.every(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        typeof (block as BlockSnapshot).id === "string" &&
        typeof (block as BlockSnapshot).type === "string" &&
        typeof (block as BlockSnapshot).text === "string",
    )
  );
}
