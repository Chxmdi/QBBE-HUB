/**
 * Whether a channel mention or reply should be written at all.
 *
 * `muted` drops both. `mentions` keeps a direct mention and drops a plain
 * reply. Required announcements are not channel messages, so they never
 * reach this check.
 */
export function channelMuteAllows(
  level: string | null | undefined,
  kind: "mention" | "reply",
): boolean {
  if (level === "muted") return false;
  if (level === "mentions") return kind === "mention";
  return true;
}

/** Hide a non-critical inbox row when its project or thread is muted. */
export function inboxItemVisible(input: {
  category: string;
  urgency: string;
  projectId?: string | null;
  threadId?: string | null;
  mutedProjectIds: readonly string[];
  mutedThreadIds: readonly string[];
}): boolean {
  if (input.category === "security") return true;
  if (
    input.category === "announcement" &&
    (input.urgency === "high" || input.urgency === "critical")
  ) {
    return true;
  }
  if (input.projectId && input.mutedProjectIds.includes(input.projectId)) return false;
  if (input.threadId && input.mutedThreadIds.includes(input.threadId)) return false;
  return true;
}
