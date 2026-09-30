import type { EditorContent } from "./content";

/** Uploads and file addresses, supplied by the page that mounts the editor. */
export interface EditorFileHandlers {
  /** Stores the file through the scanned document pipeline; returns the reference to keep in the block. */
  upload: (file: File) => Promise<string>;
  /** The address to show a stored reference at, or null while it cannot be opened (scan pending). */
  resolve: (ref: string) => Promise<string | null>;
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
  /** Id of the element describing the editor's keys; rendered by the caller. */
  hintId?: string;
  /** Accessible name; defaults to "Document content". */
  label?: string;
}
