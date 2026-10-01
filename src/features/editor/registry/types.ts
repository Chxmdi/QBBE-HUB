import type { LucideIcon } from "lucide-react";

/** Where a block's definition is grouped in menus and reports. */
export type BlockCategory = "text" | "list" | "media" | "semantic" | "layout" | "data";

/** Which code supplies the block's spec to the editor's schema. */
export type BlockSchemaSource =
  /** BlockNote's own `defaultBlockSpecs`. */
  | "default"
  /** `createWorkspaceBlocks` (callout, bookmark, embed). */
  | "workspace"
  /** `createSemanticBlocks` (blocks that point at a real object). */
  | "semantic";

/** The least role allowed to insert the block. */
export type BlockPermission = "any" | "editor" | "admin";

/**
 * One block type the editor can hold, described once (U2). The schema itself
 * stays explicit in `buildSchema`; this is the catalogue the menus, the block
 * menu's "turn into" list and later units (comments, offline, permissions)
 * read instead of their own hard-wired lists.
 */
export interface BlockDefinition {
  /** The block type as it appears in the schema and in saved content. */
  readonly type: string;
  /** The name shown to people, in both languages. */
  readonly label: Readonly<{ en: string; fr: string }>;
  readonly icon: LucideIcon;
  readonly category: BlockCategory;
  readonly schemaSource: BlockSchemaSource;
  /** What, typed at the start of a line and followed by a space, becomes this block. */
  readonly shortcuts: readonly string[];
  /** Block types the block menu offers to turn this one into; empty when it keeps its type. */
  readonly turnInto: readonly string[];
  /** Whether nested blocks may sit under it. */
  readonly childSupport: boolean;
  /** Whether a comment can be anchored to it. */
  readonly commentSupport: boolean;
  /** Whether it renders fully from the saved document while offline. */
  readonly offlineSupport: boolean;
  readonly permission: BlockPermission;
}

export const BLOCK_CATEGORIES: readonly BlockCategory[] = ["text", "list", "media", "semantic", "layout", "data"];
export const BLOCK_SCHEMA_SOURCES: readonly BlockSchemaSource[] = ["default", "workspace", "semantic"];
export const BLOCK_PERMISSIONS: readonly BlockPermission[] = ["any", "editor", "admin"];
