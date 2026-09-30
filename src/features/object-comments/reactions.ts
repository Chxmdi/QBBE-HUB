/**
 * The reactions a comment can receive (M11). The set is fixed and matches the
 * database's check constraint (20261103110100_object_comments.sql), so a new
 * one needs a migration as well as a line here.
 */
export const reactionKeys = ["thumbs_up", "heart", "celebrate", "eyes", "done", "thanks"] as const;
export type ReactionKey = (typeof reactionKeys)[number];

export const reactionEmoji: Record<ReactionKey, string> = {
  thumbs_up: "👍",
  heart: "❤️",
  celebrate: "🎉",
  eyes: "👀",
  done: "✅",
  thanks: "🙏",
};

export function isReactionKey(value: unknown): value is ReactionKey {
  return typeof value === "string" && (reactionKeys as readonly string[]).includes(value);
}

export interface ReactionSummary {
  key: ReactionKey;
  count: number;
  mine: boolean;
  /** Who reacted, for the accessible label. */
  names: string[];
}

/** Groups reaction rows per key, in the fixed order, skipping empty keys. */
export function summarizeReactions(
  rows: { reaction: string; user_id: string }[],
  currentUserId: string,
  nameOf: (userId: string) => string,
): ReactionSummary[] {
  return reactionKeys
    .map((key) => {
      const matching = rows.filter((row) => row.reaction === key);
      return {
        key,
        count: matching.length,
        mine: matching.some((row) => row.user_id === currentUserId),
        names: matching.map((row) => nameOf(row.user_id)),
      };
    })
    .filter((summary) => summary.count > 0);
}
