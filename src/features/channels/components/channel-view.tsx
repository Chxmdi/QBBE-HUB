"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SendHorizonal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageItem } from "@/features/channels/components/message-item";
import { markChannelRead } from "@/features/channels/services/channel.commands";
import {
  markConversationRead,
  sendMessage,
} from "@/features/channels/services/message.commands";
import { CHANNEL_HISTORY_PAGE_SIZE } from "@/features/channels/history";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/entities";

const MESSAGE_SELECT =
  "id, channel_id, conversation_id, thread_root_id, author_id, body, is_system, created_at, edited_at, deleted_at, " +
  "author:author_id(id, full_name, email, avatar_url, title, timezone), reactions:message_reaction(message_id, user_id, emoji)";

function mergeByCreatedAt(left: Message[], right: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of [...left, ...right]) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function Composer({
  placeholder,
  disabled,
  disabledHint,
  onSend,
  autoFocus = false,
}: {
  placeholder: string;
  disabled?: boolean;
  disabledHint?: string;
  onSend: (body: string) => Promise<{ ok: boolean; error?: string }>;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    const result = await onSend(trimmed);
    setSending(false);
    if (!result.ok) {
      // Never show success for a rejected send (Appendix B: Optimistic UI).
      setError(result.error ?? "Message not sent.");
      return;
    }
    setBody("");
    textareaRef.current?.focus();
  }

  if (disabled) {
    return (
      <p className="border-t border-line bg-surface-soft/60 px-4 py-3 text-center text-[13px] text-muted">
        {disabledHint ?? "You don't have permission to post here."}
      </p>
    );
  }

  return (
    <div className="border-t border-line bg-surface p-3">
      {error ? (
        <p role="alert" className="mb-2 text-[12.5px] text-danger-fg">
          {error} <button type="button" onClick={submit} className="font-medium underline">Retry</button>
        </p>
      ) : null}
      {/* The textarea suppresses its own outline so the box reads as one
          control, so the box has to carry the focus ring itself. */}
      <div className="flex items-end gap-2 rounded-(--radius-md) border border-line bg-canvas px-3 py-2 focus-within:border-brand focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--color-brand)">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={Math.min(6, Math.max(1, body.split("\n").length))}
          autoFocus={autoFocus}
          className="max-h-40 flex-1 resize-none bg-transparent text-[14px] outline-none placeholder:text-muted/60"
        />
        <Button
          size="sm"
          onClick={submit}
          loading={sending}
          disabled={!body.trim()}
          aria-label="Send message"
        >
          <SendHorizonal className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="meta mt-1.5 px-1">
        Enter to send · Shift+Enter for a new line · @Full Name or @Team to mention
      </p>
    </div>
  );
}

/**
 * Live message surface for channels and DMs. Durable reads come from
 * Postgres; realtime INSERT signals trigger a refetch of the new row
 * (MSG-001/MSG-010). Read cursor advances on view (MSG-007).
 */
export function ChannelView({
  channelId,
  conversationId,
  currentUserId,
  canPost,
  postDisabledHint,
  replyPolicy = "normal",
  initialMessages,
  initialSavedMessageIds = [],
  isStaff = false,
}: {
  channelId?: string;
  conversationId?: string;
  currentUserId: string;
  canPost: boolean;
  postDisabledHint?: string;
  replyPolicy?: "normal" | "threads_only" | "disabled";
  initialMessages: Message[];
  initialSavedMessageIds?: string[];
  isStaff?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [hasOlder, setHasOlder] = useState(
    initialMessages.length >= CHANNEL_HISTORY_PAGE_SIZE,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [connection, setConnection] = useState<"live" | "reconnecting">("live");
  const savedMessageIds = new Set(initialSavedMessageIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const searchParams = useSearchParams();
  const permalinkId = searchParams.get("message");
  const threadParam = searchParams.get("thread");
  const container = channelId
    ? { column: "channel_id", id: channelId }
    : { column: "conversation_id", id: conversationId! };

  const refresh = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("message")
      .select(MESSAGE_SELECT)
      .eq(container.column, container.id)
      .order("created_at", { ascending: false })
      .limit(CHANNEL_HISTORY_PAGE_SIZE);
    const latest = ([...((data ?? []) as unknown as Message[])] as Message[]).reverse();
    setMessages((current) => mergeByCreatedAt(current, latest));
  }, [container.column, container.id]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    stickToLatestRef.current = false;
    const oldest = messages[0];
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("message")
      .select(MESSAGE_SELECT)
      .eq(container.column, container.id)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(CHANNEL_HISTORY_PAGE_SIZE);
    const older = ([...((data ?? []) as unknown as Message[])] as Message[]).reverse();
    setHasOlder(older.length >= CHANNEL_HISTORY_PAGE_SIZE);
    if (older.length) {
      setMessages((current) => mergeByCreatedAt(older, current));
    }
    setLoadingOlder(false);
  }, [container.column, container.id, loadingOlder, messages]);

  // Realtime: new-message signal → refetch by cursor (MSG-010).
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const topic = `messages:${container.id}`;
    const subscription = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message",
          filter: `${container.column}=eq.${container.id}`,
        },
        () => {
          void refresh();
          if (channelId) void markChannelRead(channelId);
          if (conversationId) void markConversationRead(conversationId);
        },
      )
      .subscribe((status) => {
        // Visible but not alarming reconnect state (§14.3). On recovery we
        // refetch so nothing missed during the gap stays missing.
        if (status === "SUBSCRIBED") {
          setConnection((previous) => {
            if (previous === "reconnecting") void refresh();
            return "live";
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("reconnecting");
        }
      });
    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [container.column, container.id, channelId, conversationId, refresh]);

  // Advance the read cursor when the surface is viewed.
  useEffect(() => {
    if (channelId) void markChannelRead(channelId);
    if (conversationId) void markConversationRead(conversationId);
  }, [channelId, conversationId, messages.length]);

  // Keep scrolled to the latest message unless a permalink is targeting one
  // or the user just loaded older history.
  useEffect(() => {
    if (permalinkId || threadParam || !stickToLatestRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, permalinkId, threadParam]);

  // Consume ?message= / ?thread= (P0-MSG-06). Access is already re-checked by RLS.
  useEffect(() => {
    const targetId = permalinkId || threadParam;
    if (!targetId) return;
    const target = messages.find((m) => m.id === targetId);
    const timer = window.setTimeout(() => {
      if (target?.thread_root_id) setThreadRootId(target.thread_root_id);
      else if (threadParam) setThreadRootId(threadParam);
      document.getElementById(`message-${targetId}`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [permalinkId, threadParam, messages]);

  const roots = messages.filter((m) => !m.thread_root_id);
  const repliesByRoot = new Map<string, Message[]>();
  for (const m of messages) {
    if (m.thread_root_id) {
      const list = repliesByRoot.get(m.thread_root_id) ?? [];
      list.push(m);
      repliesByRoot.set(m.thread_root_id, list);
    }
  }
  const threadRoot = threadRootId
    ? messages.find((m) => m.id === threadRootId)
    : null;

  async function handleSend(body: string) {
    const result = await sendMessage({
      channelId,
      conversationId,
      body,
    });
    if (result.ok) {
      stickToLatestRef.current = true;
      await refresh();
    }
    return result;
  }

  async function handleThreadReply(body: string) {
    const result = await sendMessage({
      channelId,
      conversationId,
      threadRootId: threadRootId ?? undefined,
      body,
    });
    if (result.ok) await refresh();
    return result;
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Main column */}
      <div className={cn("flex min-w-0 flex-1 flex-col", threadRoot && "hidden md:flex")}>
        {connection === "reconnecting" ? (
          <p
            role="status"
            className="border-b border-line bg-warning/10 px-4 py-1.5 text-center text-[12.5px] text-warning-fg"
          >
            Reconnecting to live updates… messages you send are still saved.
          </p>
        ) : null}
        {/* role="log" is the chat transcript pattern: new arrivals are read
            out, and the history above them is not re-announced. */}
        <div
          ref={scrollRef}
          role="log"
          aria-label="Messages"
          className="min-h-0 flex-1 overflow-y-auto py-3"
        >
          {hasOlder ? (
            <div className="mb-2 flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="rounded-(--radius-sm) px-3 py-1 text-[12.5px] font-medium text-brand-fg hover:underline disabled:opacity-60"
              >
                {loadingOlder ? "Loading older messages…" : "Load older messages"}
              </button>
            </div>
          ) : null}
          {roots.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13.5px] text-muted">
              {channelId
                ? "No messages yet. This channel keeps discussion close to the work it belongs to — start the conversation below."
                : "No messages yet. This conversation is private to its participants."}
            </p>
          ) : (
            roots.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                currentUserId={currentUserId}
                channelId={channelId}
                isStaff={isStaff}
                replyCount={repliesByRoot.get(message.id)?.length ?? 0}
                highlighted={permalinkId === message.id}
                initiallySaved={savedMessageIds.has(message.id)}
                onOpenThread={
                  replyPolicy !== "disabled" ? setThreadRootId : undefined
                }
                onChanged={refresh}
                canConvert={Boolean(channelId)}
              />
            ))
          )}
        </div>
        <Composer
          placeholder="Write a message…"
          disabled={!canPost}
          disabledHint={postDisabledHint}
          onSend={handleSend}
        />
      </div>

      {/* Thread panel (P0-MSG-02) */}
      {threadRoot ? (
        <aside
          aria-label="Thread"
          className="flex w-full min-w-0 flex-col border-l border-line md:w-96"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-[13.5px] font-semibold">Thread</h2>
            <button
              type="button"
              onClick={() => setThreadRootId(null)}
              aria-label="Close thread"
              className="rounded p-1 text-muted hover:bg-surface-soft hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <MessageItem
              message={threadRoot}
              currentUserId={currentUserId}
              channelId={channelId}
              isStaff={isStaff}
              onChanged={refresh}
              isThreadReply
              highlighted={permalinkId === threadRoot.id}
              initiallySaved={savedMessageIds.has(threadRoot.id)}
            />
            <div className="mx-4 my-1 border-t border-line" />
            {(repliesByRoot.get(threadRoot.id) ?? []).map((reply) => (
              <MessageItem
                key={reply.id}
                message={reply}
                currentUserId={currentUserId}
                channelId={channelId}
                isStaff={isStaff}
                onChanged={refresh}
                isThreadReply
                highlighted={permalinkId === reply.id}
                initiallySaved={savedMessageIds.has(reply.id)}
              />
            ))}
          </div>
          <Composer
            placeholder="Reply in thread…"
            disabled={replyPolicy === "disabled"}
            disabledHint="Replies are disabled here."
            onSend={handleThreadReply}
            autoFocus
          />
        </aside>
      ) : null}
    </div>
  );
}
