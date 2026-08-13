"use client";

import { useState } from "react";
import { ListPlus, MessageSquare, SmilePlus, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  convertMessageToTask,
  deleteMessage,
  toggleReaction,
} from "@/features/channels/services/message.commands";
import { cn, formatDateTime, formatTime } from "@/lib/utils";
import type { Message } from "@/types/entities";

const QUICK_EMOJI = ["👍", "✅", "🎉", "❤️", "👀"];

export function MessageItem({
  message,
  currentUserId,
  replyCount,
  onOpenThread,
  onChanged,
  isThreadReply = false,
  canConvert = true,
}: {
  message: Message;
  currentUserId: string;
  replyCount?: number;
  onOpenThread?: (rootId: string) => void;
  onChanged: () => void;
  isThreadReply?: boolean;
  canConvert?: boolean;
}) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const deleted = Boolean(message.deleted_at);

  // Group reactions by emoji.
  const reactionGroups = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of message.reactions ?? []) {
    const group = reactionGroups.get(reaction.emoji) ?? { count: 0, mine: false };
    group.count += 1;
    if (reaction.user_id === currentUserId) group.mine = true;
    reactionGroups.set(reaction.emoji, group);
  }

  async function handleReaction(emoji: string) {
    setShowEmoji(false);
    await toggleReaction(message.id, emoji);
    onChanged();
  }

  async function handleConvert() {
    const result = await convertMessageToTask(message.id);
    setFeedback(
      result.ok ? "Task created — see My Work." : (result.error ?? "Failed."),
    );
    setTimeout(() => setFeedback(null), 4000);
  }

  async function handleDelete() {
    if (!window.confirm("Delete this message? An audit marker is retained.")) return;
    await deleteMessage(message.id);
    onChanged();
  }

  return (
    <div className={cn("group relative flex gap-2.5 px-4 py-2 hover:bg-surface-soft/50", isThreadReply && "py-1.5")}>
      <Avatar
        name={message.author?.full_name ?? "Unknown"}
        src={message.author?.avatar_url}
        size={isThreadReply ? "sm" : "md"}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold">
            {message.author?.full_name ?? "Unknown"}
          </span>
          <time
            dateTime={message.created_at}
            title={formatDateTime(message.created_at)}
            className="meta"
          >
            {formatTime(message.created_at)}
          </time>
          {message.edited_at ? <span className="meta">(edited)</span> : null}
        </p>
        {deleted ? (
          <p className="text-[13.5px] text-muted italic">
            This message was deleted.
          </p>
        ) : (
          <p className="text-[14px] break-words whitespace-pre-wrap">
            {message.body}
          </p>
        )}

        {/* Reactions */}
        {reactionGroups.size > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Array.from(reactionGroups.entries()).map(([emoji, group]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleReaction(emoji)}
                aria-label={`${emoji} reaction, ${group.count}${group.mine ? ", you reacted" : ""}`}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] transition-colors",
                  group.mine
                    ? "border-brand/40 bg-brand-soft"
                    : "border-line bg-surface hover:border-brand/30",
                )}
              >
                <span aria-hidden>{emoji}</span>
                <span>{group.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* Thread affordance */}
        {!isThreadReply && replyCount && replyCount > 0 && onOpenThread ? (
          <button
            type="button"
            onClick={() => onOpenThread(message.id)}
            className="mt-1.5 text-[12.5px] font-medium text-brand hover:underline"
          >
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
        {feedback ? (
          <p role="status" className="mt-1 text-[12.5px] text-success">
            {feedback}
          </p>
        ) : null}
      </div>

      {/* Hover / focus actions */}
      {!deleted ? (
        <div className="absolute top-1 right-3 hidden items-center gap-0.5 rounded-(--radius-sm) border border-line bg-surface p-0.5 shadow-(--shadow-raise) group-focus-within:flex group-hover:flex">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              aria-label="Add reaction"
              className="rounded p-1 text-muted hover:bg-surface-soft hover:text-ink"
            >
              <SmilePlus className="size-4" aria-hidden />
            </button>
            {showEmoji ? (
              <div className="absolute top-full right-0 z-10 mt-1 flex gap-0.5 rounded-(--radius-sm) border border-line bg-surface p-1 shadow-(--shadow-pop)">
                {QUICK_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleReaction(emoji)}
                    aria-label={`React with ${emoji}`}
                    className="rounded p-1 text-[15px] hover:bg-surface-soft"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {!isThreadReply && onOpenThread ? (
            <button
              type="button"
              onClick={() => onOpenThread(message.id)}
              aria-label="Reply in thread"
              className="rounded p-1 text-muted hover:bg-surface-soft hover:text-ink"
            >
              <MessageSquare className="size-4" aria-hidden />
            </button>
          ) : null}
          {canConvert ? (
            <button
              type="button"
              onClick={handleConvert}
              aria-label="Convert message to task"
              title="Convert to task"
              className="rounded p-1 text-muted hover:bg-surface-soft hover:text-ink"
            >
              <ListPlus className="size-4" aria-hidden />
            </button>
          ) : null}
          {message.author_id === currentUserId ? (
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Delete message"
              className="rounded p-1 text-muted hover:bg-surface-soft hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
