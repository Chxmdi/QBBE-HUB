import type { EditorContent } from "./content";

/** Uploads and file addresses, supplied by the page that mounts the editor. */
export interface EditorFileHandlers {
  /** Stores the file through the scanned document pipeline; returns the reference to keep in the block. */
  upload: (file: File) => Promise<string>;
  /** The address to show a stored reference at, or null while it cannot be opened (scan pending). */
  resolve: (ref: string) => Promise<string | null>;
}

export type SemanticKind = "task" | "decision" | "person" | "document" | "page";

/** What a semantic block shows about the object it points at. */
export interface SemanticSummary {
  id: string;
  kind: SemanticKind;
  title: string;
  detail: string | null;
  done?: boolean;
  archived?: boolean;
  /** A task's due day (YYYY-MM-DD) and assignee, read live with the title. */
  dueAt?: string | null;
  assigneeName?: string | null;
  href: string | null;
}

export interface QueryRowSummary {
  id: string;
  /** The object's type key (task, decision, meeting…). */
  type: string;
  title: string;
  href: string;
  /** A task's status key, labelled by the block; other types carry `statusLabel` instead. */
  status: string | null;
  statusLabel: string | null;
  date: string | null;
  dateLabel: "due" | "decided" | "starts" | null;
}

/** A synced block's content as the reader may see it (U5b). */
export interface SyncedBlockView {
  id: string;
  content: EditorContent;
  /** Whether the reader may edit the source, and so this content. */
  canEdit: boolean;
  /** Pages showing this block, the source's included, as far as the reader can see. */
  pageCount: number;
  /** Pending access requests, for someone who can edit the source. */
  requests: { requesterId: string; name: string }[];
}

export type SyncedAccessState = "none" | "requested" | "declined";

/** Synced blocks (U5b), supplied by the page that mounts the editor. */
export interface EditorSyncedHandlers {
  /** The block, or `access` when the reader cannot read its source (and what they asked so far). */
  load: (id: string) => Promise<{ ok: true; block: SyncedBlockView } | { ok: false; access: SyncedAccessState } | null>;
  /** Synced blocks the reader can see, newest first, with a line of their text. */
  list: (query: string) => Promise<{ id: string; preview: string; sourceTitle: string }[]>;
  /** Makes a synced block from blocks on this page; returns its id. */
  create: (blockId: string, content: EditorContent) => Promise<string | null>;
  update: (id: string, content: EditorContent) => Promise<boolean>;
  requestAccess: (id: string) => Promise<boolean>;
  decideAccess: (id: string, requesterId: string, grant: boolean) => Promise<boolean>;
}

export type ButtonActionKey = "task.create" | "object.set_property";

export type ButtonActionResult =
  /** `changeSetId` is null when the action ran but its undo could not be recorded. */
  | { ok: true; changeSetId: string | null; message: string; href: string | null }
  | { ok: false; error: string };

/** Button blocks (U5b): run one registered action, then offer undo. */
export interface EditorActionHandlers {
  run: (actionKey: ButtonActionKey, args: Record<string, string>) => Promise<ButtonActionResult>;
  undo: (changeSetId: string) => Promise<boolean>;
  /** The title of the item a set-property button changes, for its confirmation. */
  describe: (objectId: string) => Promise<string | null>;
}

/** Data for semantic blocks (M5), supplied by the page that mounts the editor. */
export interface EditorSemanticHandlers {
  summarize: (refs: { kind: SemanticKind; id: string }[]) => Promise<SemanticSummary[]>;
  search: (kind: SemanticKind, query: string) => Promise<SemanticSummary[]>;
  /** Projects a new task can be created in. */
  projects: () => Promise<{ id: string; name: string }[]>;
  /** The project offered first for a new task: the meeting's, say. */
  defaultProjectId?: string | null;
  /** People a new task can be assigned to. */
  people?: () => Promise<{ id: string; name: string }[]>;
  /**
   * Whether a task created from a block must name its owner and due date:
   * true in meeting notes, where the end-of-meeting review and the actions
   * list need both; a page's task may stay unowned and undated.
   */
  requireOwnerAndDue?: boolean;
  createTask: (
    title: string,
    projectId: string | null,
    extras?: { assigneeId?: string; dueAt?: string },
  ) => Promise<SemanticSummary | null>;
  /** "Turn into page" (M6); absent where there is no page to nest under. */
  turnIntoPage?: (title: string, content: EditorContent) => Promise<SemanticSummary | null>;
  setTaskDone: (taskId: string, done: boolean) => Promise<boolean>;
  runQuery: (spec: string) => Promise<QueryRowSummary[] | null>;
  openFile: (documentId: string) => Promise<string | null>;
  /** Synced blocks (U5b); absent where the document cannot hold them. */
  synced?: EditorSyncedHandlers;
  /** Button blocks (U5b); absent where buttons cannot run. */
  actions?: EditorActionHandlers;
}

/** The rule-based "Make a task" suggestion (M6). */
export interface TaskSuggestionOptions {
  enabled: boolean;
  people: { id: string; name: string }[];
  /** Today's calendar date in the organization's zone, YYYY-MM-DD. */
  today: string;
}

/** The only editor interface the rest of the app uses. */
export interface BlockEditorProps {
  initialContent: EditorContent;
  /**
   * The saved collaboration state (a Yjs update, base64), when there is one.
   * Without it the editor starts from `initialContent`.
   */
  initialState?: string | null;
  editable: boolean;
  /** The document as JSON and its collaboration state, after every change. */
  onChange?: (content: EditorContent, state: string) => void;
  files?: EditorFileHandlers;
  /** Enables the semantic blocks (task, decision, person, status, query, library file). */
  semantic?: EditorSemanticHandlers;
  taskSuggestions?: TaskSuggestionOptions;
  /** Id of the element describing the editor's keys; rendered by the caller. */
  hintId?: string;
  /** Accessible name; defaults to "Document content". */
  label?: string;
  /**
   * The object's address, such as `/pages/<id>`. "Copy link" in the block
   * handle menu copies `<objectPath>#block-<blockId>`; without it, the block id.
   */
  objectPath?: string;
  /** "Comment" in the block handle menu; the item is left out when absent. */
  onCommentBlock?: (blockId: string) => void;
}
