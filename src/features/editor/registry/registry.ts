import {
  Activity,
  AudioLines,
  Bookmark,
  ChevronRight,
  Code,
  File,
  FileText,
  Gavel,
  Heading,
  Image,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTodo,
  MessageSquareWarning,
  Minus,
  MousePointerClick,
  PanelTop,
  Repeat2,
  SquareCheck,
  Table,
  TextQuote,
  Type,
  UserRound,
  Video,
} from "lucide-react";
import { editorEn, editorFrCA } from "@/features/editor/i18n";
import type { BlockDefinition } from "./types";

/**
 * The block types `buildSchema` holds today, in menu order. Text blocks can be
 * turned into one another from the block menu; the rest keep their type.
 * Adding a block to the schema means adding its entry here (the registry test
 * checks both directions) and its name to both dictionaries, nothing more.
 */

/** Blocks the block menu offers "turn into" for, in the order it lists them. */
const TURN_INTO_TYPES: readonly string[] = Object.freeze([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "callout",
  "codeBlock",
]);

/** Settings shared by the text blocks: they turn into one another and hold nested blocks. */
const TEXT = { turnInto: TURN_INTO_TYPES, childSupport: true } as const;

/** Dictionary keys a block's name may come from, by schema source. */
type DefaultType = keyof typeof editorEn.types & keyof typeof editorFrCA.types;
type WorkspaceType = Exclude<keyof typeof editorEn.slash, "group"> & keyof typeof editorFrCA.slash;
type SemanticType = keyof typeof editorEn.semantic.items & keyof typeof editorFrCA.semantic.items;

type RequiredKeys = "icon" | "category";
type Rest = Pick<BlockDefinition, RequiredKeys> & Partial<Omit<BlockDefinition, RequiredKeys | "type" | "label" | "schemaSource">>;

const define = (type: string, label: { en: string; fr: string }, schemaSource: BlockDefinition["schemaSource"], rest: Rest) =>
  Object.freeze<BlockDefinition>({
    shortcuts: Object.freeze([]),
    turnInto: Object.freeze([]),
    childSupport: false,
    commentSupport: true,
    offlineSupport: true,
    permission: "any",
    ...rest,
    type,
    label: Object.freeze({ ...label }),
    schemaSource,
    ...(rest.shortcuts ? { shortcuts: Object.freeze([...rest.shortcuts]) } : {}),
    ...(rest.turnInto ? { turnInto: Object.freeze([...rest.turnInto]) } : {}),
  });

/** A BlockNote default block, named by `types.*`. */
const defaultBlock = (type: DefaultType, rest: Rest) =>
  define(type, { en: editorEn.types[type], fr: editorFrCA.types[type] }, "default", rest);

/** A workspace block (blocks.tsx), named by its slash item. */
const workspaceBlock = (type: WorkspaceType, rest: Rest) =>
  define(type, { en: editorEn.slash[type].title, fr: editorFrCA.slash[type].title }, "workspace", rest);

/** A semantic block (semantic-blocks.tsx), named by its slash item; it needs the page's handlers to render. */
const semanticBlock = (type: SemanticType, rest: Rest) =>
  define(
    type,
    { en: editorEn.semantic.items[type].title, fr: editorFrCA.semantic.items[type].title },
    "semantic",
    { offlineSupport: false, permission: "editor", ...rest },
  );

/** A block that needs its own handler group (synced blocks, buttons), named by its slash item. */
const handledBlock = (type: "syncedBlock" | "button", schemaSource: "synced" | "action", rest: Rest) =>
  define(
    type,
    { en: editorEn[type].slash.title, fr: editorFrCA[type].slash.title },
    schemaSource,
    { offlineSupport: false, permission: "editor", ...rest },
  );

export const BLOCK_REGISTRY: readonly BlockDefinition[] = Object.freeze([
  defaultBlock("paragraph", { ...TEXT, icon: Type, category: "text" }),
  defaultBlock("heading", { ...TEXT, icon: Heading, category: "text", shortcuts: ["#", "##", "###"] }),
  defaultBlock("bulletListItem", { ...TEXT, icon: List, category: "list", shortcuts: ["-", "+", "*"] }),
  defaultBlock("numberedListItem", { ...TEXT, icon: ListOrdered, category: "list", shortcuts: ["1."] }),
  defaultBlock("checkListItem", { ...TEXT, icon: SquareCheck, category: "list", shortcuts: ["[]", "[x]"] }),
  defaultBlock("toggleListItem", { ...TEXT, icon: ChevronRight, category: "list" }),
  defaultBlock("quote", { ...TEXT, icon: TextQuote, category: "text", shortcuts: [">"] }),
  workspaceBlock("callout", { ...TEXT, icon: MessageSquareWarning, category: "text" }),
  defaultBlock("codeBlock", { ...TEXT, icon: Code, category: "text", shortcuts: ["```"], childSupport: false }),
  defaultBlock("table", { icon: Table, category: "data" }),
  defaultBlock("divider", { icon: Minus, category: "layout", shortcuts: ["---"], commentSupport: false }),
  defaultBlock("image", { icon: Image, category: "media" }),
  defaultBlock("file", { icon: File, category: "media" }),
  defaultBlock("video", { icon: Video, category: "media" }),
  defaultBlock("audio", { icon: AudioLines, category: "media" }),
  workspaceBlock("bookmark", { icon: Bookmark, category: "media" }),
  workspaceBlock("embed", { icon: PanelTop, category: "media" }),
  semanticBlock("task", { icon: ListChecks, category: "semantic" }),
  semanticBlock("decision", { icon: Gavel, category: "semantic" }),
  semanticBlock("person", { icon: UserRound, category: "semantic" }),
  // Status is a state kept in the block itself, so it renders offline.
  semanticBlock("status", { icon: Activity, category: "semantic", offlineSupport: true }),
  semanticBlock("query", { icon: ListTodo, category: "data" }),
  semanticBlock("libraryFile", { icon: FileText, category: "semantic" }),
  semanticBlock("pageLink", { icon: Link2, category: "semantic" }),
  handledBlock("syncedBlock", "synced", { icon: Repeat2, category: "layout" }),
  handledBlock("button", "action", { icon: MousePointerClick, category: "data" }),
]);

const BY_TYPE: ReadonlyMap<string, BlockDefinition> = new Map(BLOCK_REGISTRY.map((entry) => [entry.type, entry]));

/** The definition for a block type, or undefined for a type the editor does not know. */
export function blockDefinition(type: string): BlockDefinition | undefined {
  return BY_TYPE.get(type);
}
