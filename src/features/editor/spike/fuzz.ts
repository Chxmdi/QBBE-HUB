import type { BlockNoteEditor } from "@blocknote/core";

/**
 * W0-6 spike: random edits for the convergence test, made through the real
 * editor (ProseMirror transactions that y-prosemirror turns into Yjs updates),
 * not on the Yjs document directly.
 *
 * Every insert is a unique token such as `[A17é]` placed between whole tokens,
 * so no token can be split by another and "no lost edits" is checkable: after
 * both sides converge, every token inserted and not deliberately deleted must
 * appear exactly once. Accented letters exercise the UTF-16 offsets French
 * text needs.
 */

export type FuzzOpKind = "insert" | "newBlock" | "bold" | "delete" | "turnInto";

export interface FuzzResult {
  kind: FuzzOpKind;
  token?: string;
  deleted?: string[];
}

const TOKEN = /\[[AB]\d+[éàçèô]\]/g;
const ACCENTS = ["é", "à", "ç", "è", "ô"];

interface Textblock {
  /** Position just inside the textblock (where its text starts). */
  start: number;
  text: string;
  blockId: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

function textblocks(editor: AnyEditor): Textblock[] {
  const result: Textblock[] = [];
  let blockId: string | null = null;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (node.type.name === "blockContainer") blockId = (node.attrs.id as string) ?? null;
    if (node.isTextblock) {
      // Code blocks and tables are left alone; they do not take tokens.
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        result.push({ start: pos + 1, text: node.textContent, blockId });
      }
      return false;
    }
    return true;
  });
  return result;
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function tokenRanges(block: Textblock) {
  return [...block.text.matchAll(TOKEN)].map((match) => ({
    token: match[0],
    from: block.start + (match.index ?? 0),
    to: block.start + (match.index ?? 0) + match[0].length,
  }));
}

export function applyRandomEdit(
  editor: AnyEditor,
  side: "A" | "B",
  n: number,
  random: () => number,
  { allowTurnInto = false }: { allowTurnInto?: boolean } = {},
): FuzzResult {
  const blocks = textblocks(editor);
  const token = `[${side}${n}${pick(ACCENTS, random)}]`;
  const roll = random();

  if (blocks.length === 0 || roll < 0.6) {
    // Insert a token between whole tokens of a random block.
    const block = blocks.length ? pick(blocks, random) : null;
    if (!block) return insertBlock(editor, token, random);
    const boundaries = [block.start, ...tokenRanges(block).map((r) => r.to)];
    const at = pick(boundaries, random);
    editor.transact((tr) => {
      tr.insertText(token, at);
    });
    return { kind: "insert", token };
  }
  if (roll < 0.75) return insertBlock(editor, token, random);

  const withTokens = blocks.filter((b) => tokenRanges(b).length > 0);
  if (withTokens.length === 0) return insertBlock(editor, token, random);
  const block = pick(withTokens, random);
  const range = pick(tokenRanges(block), random);

  if (roll < 0.87) {
    editor.transact((tr) => {
      tr.addMark(range.from, range.to, tr.doc.type.schema.marks.bold.create());
    });
    return { kind: "bold" };
  }
  if (roll < 0.97 || !allowTurnInto) {
    editor.transact((tr) => {
      tr.delete(range.from, range.to);
    });
    return { kind: "delete", deleted: [range.token] };
  }
  // Changing a block's type replaces its content node, which is where
  // y-prosemirror is weakest; kept behind a switch and measured separately.
  if (block.blockId) {
    const current = editor.getBlock(block.blockId);
    editor.updateBlock(block.blockId, current?.type === "heading" ? { type: "paragraph" } : { type: "heading", props: { level: 2 } });
  }
  return { kind: "turnInto" };
}

function insertBlock(editor: AnyEditor, token: string, random: () => number): FuzzResult {
  const document = editor.document;
  const reference = document[Math.floor(random() * document.length)] ?? document[0];
  editor.insertBlocks([{ type: "paragraph", content: token }], reference, "after");
  return { kind: "newBlock", token };
}

/** Every token in the editor, in document order. */
export function tokensIn(editor: AnyEditor): string[] {
  return textblocks(editor).flatMap((block) => tokenRanges(block).map((r) => r.token));
}

/** A small deterministic generator, so a failing run can be replayed from its seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
