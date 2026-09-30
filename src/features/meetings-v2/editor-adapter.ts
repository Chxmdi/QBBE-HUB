import type { ComponentType } from "react";
import type { Uuid } from "@/lib/objects/contracts";

/**
 * The contract between meeting notes and the block editor (stream S3).
 *
 * Contract addition: the editor stream has not merged yet, so meetings build
 * against this adapter and ship a placeholder that implements it with a plain
 * text area. When the editor lands, its meeting-notes binding implements the
 * same props: it renders the notes and calls `onSemanticBlock` whenever a
 * person inserts a task, decision, question or follow-up block. Nothing else
 * in this module changes.
 */
export const semanticBlockKinds = ["decision", "task", "question", "follow_up"] as const;
export type SemanticBlockKind = (typeof semanticBlockKinds)[number];

export interface SemanticBlock {
  kind: SemanticBlockKind;
  text: string;
}

export interface MeetingNotesEditorProps {
  meetingId: Uuid;
  initialContent: string;
  readOnly: boolean;
  /**
   * Saves the notes and captures every semantic block in them for the review.
   * `content` is the notes as saved (captured lines rewritten); the editor
   * shows it from then on so the same block is never captured twice.
   */
  onSave: (content: string) => Promise<{ ok: boolean; captured: number; content: string }>;
}

export type MeetingNotesEditor = ComponentType<MeetingNotesEditorProps>;

/**
 * Slash commands the placeholder understands, English and Quebec French, with
 * or without accents. Matching is on the first word of a line only.
 */
const COMMANDS: Record<string, SemanticBlockKind> = {
  task: "task",
  todo: "task",
  tache: "task",
  "tâche": "task",
  decision: "decision",
  "décision": "decision",
  question: "question",
  "follow-up": "follow_up",
  followup: "follow_up",
  suivi: "follow_up",
};

/** The label a captured line is rewritten to, so saving twice captures once. */
const CAPTURED_PREFIX: Record<SemanticBlockKind, string> = {
  task: "Task:",
  decision: "Decision:",
  question: "Question:",
  follow_up: "Follow-up:",
};

const MAX_BLOCK_LENGTH = 500;

/**
 * Finds `/task Buy chairs`-style lines in plain notes. Returns the blocks and
 * the notes with each captured line rewritten as `Task: Buy chairs`, so the
 * notes still read naturally and the same line is not captured again on the
 * next save. A command with no text after it is left alone.
 */
export function extractSemanticBlocks(notes: string): { blocks: SemanticBlock[]; notes: string } {
  const blocks: SemanticBlock[] = [];
  const lines = notes.split("\n").map((line) => {
    const match = /^(\s*)\/([\p{L}-]+)(?:\s+(.*))?$/u.exec(line);
    if (!match) return line;
    const kind = COMMANDS[match[2].toLowerCase()];
    const text = (match[3] ?? "").trim();
    if (!kind || !text) return line;
    blocks.push({ kind, text: text.slice(0, MAX_BLOCK_LENGTH) });
    return `${match[1]}${CAPTURED_PREFIX[kind]} ${text}`;
  });
  return { blocks, notes: lines.join("\n") };
}
