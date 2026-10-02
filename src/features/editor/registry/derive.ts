import * as React from "react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu, type BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { EditorKey, EditorT } from "@/features/editor/i18n";
import { rankByTitle } from "@/features/editor/adapter/slash";
import { insertColumn, insertColumnList, insertTableOfContents } from "@/features/editor/adapter/blocknote/layout-blocks";
import { BLOCK_REGISTRY, blockDefinition } from "./registry";
import type { BlockDefinition } from "./types";

/**
 * What the editor derives from the registry: the block menu's "turn into"
 * list, the set of blocks that list applies to, and the slash menu's items.
 * The order is the registry's order, so a block's place in every menu is set
 * in one file.
 */

/** Heading levels the block menu offers; BlockNote's heading carries the level as a prop. */
const HEADING_LEVELS = [1, 2, 3] as const;

export type TurnIntoKey =
  | "paragraph"
  | `heading${(typeof HEADING_LEVELS)[number]}`
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "toggleListItem"
  | "quote"
  | "callout"
  | "codeBlock";

export interface TurnIntoTarget {
  key: TurnIntoKey;
  /** The dictionary key of the name shown in the menu ("Turn into {type}"). */
  labelKey: EditorKey;
  /** The change applied to the block. */
  block: { type: string; props?: Record<string, string | number | boolean> };
}

/** Block types that offer "turn into" (those whose definition lists targets). */
export function textTypes(): ReadonlySet<string> {
  return new Set(BLOCK_REGISTRY.filter((entry) => entry.turnInto.length > 0).map((entry) => entry.type));
}

/**
 * The block menu's "turn into" targets for a block type (its definition's
 * list), or for every block when no type is given, in registry order with
 * headings expanded one entry per level. An unknown type has none.
 */
export function turnIntoTargets(type?: string): readonly TurnIntoTarget[] {
  const wanted = new Set(type === undefined ? BLOCK_REGISTRY.flatMap((entry) => entry.turnInto) : blockDefinition(type)?.turnInto ?? []);
  return BLOCK_REGISTRY.filter((entry) => wanted.has(entry.type)).flatMap((entry): TurnIntoTarget[] => {
    if (entry.type === "heading") {
      return HEADING_LEVELS.map((level) => ({
        key: `heading${level}`,
        labelKey: `types.heading${level}`,
        block: { type: "heading", props: { level } },
      }));
    }
    const key = entry.type as Exclude<TurnIntoKey, `heading${number}`>;
    return [{ key, labelKey: `types.${key}`, block: { type: entry.type } }];
  });
}

/** The editor surface the slash items need: any BlockNote editor whose schema holds the registry's blocks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlashEditor = BlockNoteEditor<any, any, any>;

type SlashKeys = { title: EditorKey; subtext: EditorKey; aliases: EditorKey };

/** Where a workspace, layout or semantic block's slash item strings live; the registry test checks they resolve. */
const dictionaryKeys = (entry: BlockDefinition): SlashKeys => {
  if (entry.schemaSource === "workspace" || entry.schemaSource === "layout") {
    const type = entry.type as "callout" | "bookmark" | "embed" | "columnList" | "column" | "tableOfContents";
    return { title: `slash.${type}.title`, subtext: `slash.${type}.subtext`, aliases: `slash.${type}.aliases` };
  }
  const type = entry.type as "task" | "decision" | "person" | "status" | "query" | "libraryFile" | "pageLink";
  return { title: `semantic.items.${type}.title`, subtext: `semantic.items.${type}.subtext`, aliases: `semantic.items.${type}.aliases` };
};

export interface SlashItemOptions {
  /** BlockNote's own items for its default blocks (already filtered as the editor wants them). */
  defaults?: DefaultReactSuggestionItem[];
  /** Whether the page supplied semantic handlers; without them the semantic blocks are left out. */
  semantic: boolean;
}

/**
 * Layout blocks keep their structure on insert (a column list arrives with two
 * columns, a column joins the list around the cursor), so they insert through
 * their own helpers rather than BlockNote's plain slash insert.
 */
const LAYOUT_INSERTS: Readonly<Record<string, (editor: SlashEditor) => void>> = {
  columnList: insertColumnList,
  column: insertColumn,
  tableOfContents: insertTableOfContents,
};

/**
 * The slash menu's items: BlockNote's default items first, then one item per
 * workspace block, per layout block and, when the page can show them, per
 * semantic block, in registry order with the registry's icon. Layout blocks sit
 * under the "Layout" group, the rest under "Workspace".
 */
export function slashItems(t: EditorT, editor: SlashEditor, options: SlashItemOptions): DefaultReactSuggestionItem[] {
  const group = t("slash.group");
  const layoutGroup = t("slash.layoutGroup");
  const own = BLOCK_REGISTRY.flatMap((entry): DefaultReactSuggestionItem[] => {
    if (entry.schemaSource === "default") return [];
    if (entry.schemaSource === "semantic" && !options.semantic) return [];
    const keys = dictionaryKeys(entry);
    return [
      {
        title: t(keys.title),
        subtext: t(keys.subtext),
        aliases: t(keys.aliases).split(","),
        group: entry.schemaSource === "layout" ? layoutGroup : group,
        icon: React.createElement(entry.icon, { size: 18, "aria-hidden": true }),
        onItemClick: () => {
          const insert = LAYOUT_INSERTS[entry.type];
          if (insert) insert(editor);
          else insertOrUpdateBlockForSlashMenu(editor, { type: entry.type } as PartialBlock);
        },
      },
    ];
  });
  return [...(options.defaults ?? []), ...own];
}

/**
 * The items matching what was typed, those whose title starts with it first
 * (the ranking the editor has always used, from `rankByTitle`).
 */
export function rankSlashItems<T extends DefaultReactSuggestionItem>(items: T[], query: string): T[] {
  return rankByTitle(filterSuggestionItems(items, query), query);
}
