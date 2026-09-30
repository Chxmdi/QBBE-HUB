/**
 * Mentions inside a comment body (M11).
 *
 * A mention is stored in the body as `@[label](person:<uuid>)` or
 * `@[label](object:<uuid>)`, so the text reads sensibly even where it is not
 * rendered (an email, an export) and the target survives a rename. The label
 * is what the author saw when they wrote it; readers are shown the current
 * name when they can see the target, and a neutral placeholder otherwise.
 */

export type MentionKind = "person" | "object";

export interface Mention {
  kind: MentionKind;
  id: string;
  label: string;
}

export type BodySegment = { type: "text"; text: string } | { type: "mention"; mention: Mention };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MENTION = new RegExp(`@\\[([^\\]\\n]{1,120})\\]\\((person|object):(${UUID})\\)`, "gi");

/** The most mentions of each kind a comment may carry (set_comment_mentions). */
export const MAX_MENTIONS = 20;

/** Brackets and parentheses would break the token, so they are dropped from labels. */
export function cleanLabel(label: string): string {
  return label.replace(/[[\]()\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function mentionToken(mention: Mention): string {
  return `@[${cleanLabel(mention.label) || "?"}](${mention.kind}:${mention.id.toLowerCase()})`;
}

export function splitBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: "text", text: body.slice(last, start) });
    segments.push({
      type: "mention",
      mention: {
        label: match[1],
        kind: match[2].toLowerCase() as MentionKind,
        id: match[3].toLowerCase(),
      },
    });
    last = start + match[0].length;
  }
  if (last < body.length) segments.push({ type: "text", text: body.slice(last) });
  return segments;
}

/** Distinct mentioned ids per kind, in the order they first appear. */
export function extractMentions(body: string): { people: string[]; objects: string[] } {
  const people: string[] = [];
  const objects: string[] = [];
  for (const segment of splitBody(body)) {
    if (segment.type !== "mention") continue;
    const list = segment.mention.kind === "person" ? people : objects;
    if (!list.includes(segment.mention.id)) list.push(segment.mention.id);
  }
  return { people, objects };
}

/** The body as plain text, with each mention reduced to `@label`. */
export function plainText(body: string): string {
  return splitBody(body)
    .map((segment) => (segment.type === "text" ? segment.text : `@${segment.mention.label}`))
    .join("");
}

/**
 * The `@query` being typed at the caret, if any: an `@` at the start or after
 * whitespace, followed by up to 40 characters without a line break or another
 * `@`. Returns where it starts so the pick can replace it.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^@\n[\]()]{0,40})$/.exec(before);
  if (!match) return null;
  const start = before.length - match[2].length - 1;
  return { start, query: match[2] };
}

/** Replaces the `@query` at `start` with the mention token and a space. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  mention: Mention,
): { text: string; caret: number } {
  const token = `${mentionToken(mention)} `;
  const next = text.slice(0, start) + token + text.slice(caret);
  return { text: next, caret: start + token.length };
}
