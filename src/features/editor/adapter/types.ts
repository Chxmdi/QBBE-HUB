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
  editable: boolean;
  onChange?: (content: EditorContent) => void;
  files?: EditorFileHandlers;
  /** Id of the element describing the editor's keys; rendered by the caller. */
  hintId?: string;
  /** Accessible name; defaults to "Document content". */
  label?: string;
}
