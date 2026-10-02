/**
 * Undo history for the block editor (wave 2, E2). The editor keeps its
 * document in Yjs, and Yjs' own undo manager (the one the editor library
 * installs) holds the steps. This file decides where one step ends and the
 * next begins, and when the history must start again. It knows nothing of the
 * editor library or the DOM, so it is tested against a plain Yjs document.
 *
 * Steps:
 *   - Typing in one block is one step (the undo manager groups key presses
 *     made within half a second of each other).
 *   - Every other change (a new block, a move, turn into, a colour, a
 *     duplicate, a delete, a paste) is a step of its own, never merged with
 *     the typing before or after it.
 *   - The history starts at the page's opened state: whatever the editor
 *     does to the document while it opens is not a step.
 *   - A change from someone else (a save from another window, or later a
 *     live co-editor) starts the history again, so an undo never silently
 *     reaches over their change.
 */

/** The part of Yjs' UndoManager this file uses. */
export interface UndoStackLike {
  undoStack: readonly unknown[];
  redoStack: readonly unknown[];
  undo(): unknown;
  redo(): unknown;
  stopCapturing(): void;
  clear(clearUndoStack?: boolean, clearRedoStack?: boolean): void;
}

/** A block as the editor reports it in a change (only what is compared). */
interface ChangedBlock {
  id: string;
  type: string;
  props?: unknown;
  content?: unknown;
}

/** One entry of the editor's list of block changes for a transaction. */
export interface BlockChange {
  type: "insert" | "delete" | "update" | "move";
  source: { type: string };
  block: ChangedBlock;
  prevBlock?: ChangedBlock;
}

export type ChangeKind =
  | { kind: "none" }
  /** Text typed or removed inside one block. */
  | { kind: "text"; blockId: string }
  /** Anything that adds, removes, moves or reshapes blocks. */
  | { kind: "structure" };

const NONE: ChangeKind = { kind: "none" };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What a transaction's block changes amount to. Changes the history makes
 * itself (undo, redo) and changes that arrive from elsewhere are "none":
 * they never decide where a step ends.
 */
export function classifyChanges(changes: readonly BlockChange[]): ChangeKind {
  let textBlock: string | null = null;
  for (const change of changes) {
    if (change.source.type !== "local" && change.source.type !== "paste" && change.source.type !== "drop") return NONE;
    if (change.source.type !== "local") return { kind: "structure" };
    if (change.type !== "update" || !change.prevBlock) return { kind: "structure" };
    const before = change.prevBlock;
    const after = change.block;
    if (before.type !== after.type || !same(before.props, after.props)) return { kind: "structure" };
    // A parent is reported as updated when a child changes; only the block
    // whose own text changed counts.
    if (same(before.content, after.content)) continue;
    if (textBlock !== null && textBlock !== after.id) return { kind: "structure" };
    textBlock = after.id;
  }
  return textBlock === null ? NONE : { kind: "text", blockId: textBlock };
}

export type HistoryOutcome = "done" | "empty";

/**
 * The editor's undo history. `manager` is read on every call, because the
 * editor library may replace its undo manager when the editor remounts.
 */
export class EditorHistory {
  private last: ChangeKind = NONE;
  private opened = false;

  constructor(private readonly manager: () => UndoStackLike | null) {}

  /**
   * Called before each change is applied. A change of a different kind, or
   * typing in another block, closes the step before it.
   */
  beforeChange(kind: ChangeKind): void {
    if (kind.kind === "none") return;
    const manager = this.manager();
    const continuesTyping = kind.kind === "text" && this.last.kind === "text" && this.last.blockId === kind.blockId;
    if (!continuesTyping) manager?.stopCapturing();
    this.last = kind;
  }

  /**
   * Called after each change. Until the person first acts on the page, what
   * the editor did while opening is not a step: the history is emptied.
   */
  afterChange(): void {
    if (!this.opened) this.manager()?.clear();
  }

  /** The person has acted on the page: from now on their changes are steps. */
  markOpened(): void {
    if (this.opened) return;
    this.manager()?.clear();
    this.opened = true;
  }

  canUndo(): boolean {
    return (this.manager()?.undoStack.length ?? 0) > 0;
  }

  canRedo(): boolean {
    return (this.manager()?.redoStack.length ?? 0) > 0;
  }

  undo(): HistoryOutcome {
    const manager = this.manager();
    if (!manager || manager.undoStack.length === 0) return "empty";
    this.last = NONE;
    return manager.undo() == null ? "empty" : "done";
  }

  redo(): HistoryOutcome {
    const manager = this.manager();
    if (!manager || manager.redoStack.length === 0) return "empty";
    this.last = NONE;
    return manager.redo() == null ? "empty" : "done";
  }

  /**
   * Someone else changed the page: the history starts again from here.
   * Returns whether there was anything to forget.
   */
  restart(): boolean {
    const manager = this.manager();
    const had = this.canUndo() || this.canRedo();
    manager?.clear();
    manager?.stopCapturing();
    this.last = NONE;
    return had;
  }
}

/**
 * Whether a document change came from someone else: an update applied from
 * outside this editor (another window, a live co-editor), not one typed here.
 */
export function isRemoteChange(transaction: { local: boolean; changed: { size: number } }): boolean {
  return !transaction.local && transaction.changed.size > 0;
}

/** Whether the save queue just learned that someone else saved the page. */
export function savedElsewhere(previous: string | null, now: string | null): boolean {
  return now === "conflict" && previous !== "conflict";
}
