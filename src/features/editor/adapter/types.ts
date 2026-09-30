import type { EditorContent } from "./content";

/** Uploads and file addresses, supplied by the page that mounts the editor. */
export interface EditorFileHandlers {
  /** Stores the file through the scanned document pipeline; returns the reference to keep in the block. */
  upload: (file: File) => Promise<string>;
  /** The address to show a stored reference at, or null while it cannot be opened (scan pending). */
  resolve: (ref: string) => Promise<string | null>;
}

export type SemanticKind = "task" | "decision" | "person" | "document";

/** What a semantic block shows about the object it points at. */
export interface SemanticSummary {
  id: string;
  kind: SemanticKind;
  title: string;
  detail: string | null;
  done?: boolean;
  archived?: boolean;
  href: string | null;
}

export interface QueryRowSummary {
  id: string;
  title: string;
  status: string | null;
  due: string | null;
}

/** Data for semantic blocks (M5), supplied by the page that mounts the editor. */
export interface EditorSemanticHandlers {
  summarize: (refs: { kind: SemanticKind; id: string }[]) => Promise<SemanticSummary[]>;
  search: (kind: SemanticKind, query: string) => Promise<SemanticSummary[]>;
  /** Projects a new task can be created in. */
  projects: () => Promise<{ id: string; name: string }[]>;
  createTask: (title: string, projectId: string | null) => Promise<SemanticSummary | null>;
  setTaskDone: (taskId: string, done: boolean) => Promise<boolean>;
  runQuery: (spec: string) => Promise<QueryRowSummary[] | null>;
  openFile: (documentId: string) => Promise<string | null>;
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
  /** Id of the element describing the editor's keys; rendered by the caller. */
  hintId?: string;
  /** Accessible name; defaults to "Document content". */
  label?: string;
}
