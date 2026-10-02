/**
 * The Markdown shortcuts typed at the start of a line, as one table. The
 * editor's own typing rules (BlockNote's, plus the callout rule E1 adds) and
 * the Markdown paste reader both follow it, so pasted Markdown becomes the
 * same blocks as typing it.
 */

export interface ShortcutBlock {
  type: string;
  props?: Record<string, string | number | boolean>;
}

export interface LineShortcut {
  block: ShortcutBlock;
  /** The rest of the line, after the shortcut and its space. */
  rest: string;
}

/** `>!` then a space turns the line into a callout (E1's own typing rule). */
export const CALLOUT_TYPED = ">!";

const RULES: { find: RegExp; block: (match: RegExpExecArray) => ShortcutBlock }[] = [
  { find: /^(#{1,6})[ \t]/, block: (m) => ({ type: "heading", props: { level: m[1].length } }) },
  { find: /^>![ \t]/, block: () => ({ type: "callout", props: { tone: "info" } }) },
  { find: /^>[ \t]/, block: () => ({ type: "quote" }) },
  { find: /^[-+*][ \t]/, block: () => ({ type: "bulletListItem" }) },
  { find: /^(\d{1,9})\.[ \t]/, block: (m) => (Number(m[1]) === 1 ? { type: "numberedListItem" } : { type: "numberedListItem", props: { start: Number(m[1]) } }) },
  { find: /^\[\s*\][ \t]/, block: () => ({ type: "checkListItem", props: { checked: false } }) },
  { find: /^\[[xX]\][ \t]/, block: () => ({ type: "checkListItem", props: { checked: true } }) },
];

/** A line that is a divider when typed or pasted: exactly three hyphens. */
export function isDividerLine(line: string): boolean {
  return line.trim() === "---";
}

/** The opening of a code block: three backticks and an optional language. */
export function codeFence(line: string): { language: string } | null {
  const match = /^```([^`]*)$/.exec(line.trim());
  if (!match) return null;
  return { language: codeLanguage(match[1]) };
}

/** The language written after the backticks, kept only when it reads as one. */
export function codeLanguage(raw: string): string {
  const word = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[a-z0-9+#-]{1,20}$/.test(word) ? word : "text";
}

/**
 * The block a line's start turns it into, and the rest of the line. A
 * checklist marker after a list marker (`- [ ] x`) makes a checklist item, as
 * typing `[] ` in a list item does. A heading's text is never re-read.
 */
export function lineShortcut(line: string): LineShortcut | null {
  for (const rule of RULES) {
    const match = rule.find.exec(line);
    if (!match) continue;
    const block = rule.block(match);
    const rest = line.slice(match[0].length);
    if (block.type === "bulletListItem" || block.type === "numberedListItem") {
      const inner = lineShortcut(rest);
      if (inner && inner.block.type === "checkListItem") return inner;
    }
    return { block, rest };
  }
  return null;
}
