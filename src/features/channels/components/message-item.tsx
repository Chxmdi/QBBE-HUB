"use client";

import { useState } from "react";
import {
  CalendarPlus,
  Gavel,
  Link2,
  ListPlus,
  MessageSquare,
  Pencil,
  Pin,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import {
  convertMessageToAgendaItem,
  convertMessageToDecision,
  convertMessageToTask,
  deleteMessage,
  editMessage,
  pinMessage,
  toggleReaction,
} from "@/features/channels/services/message.commands";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn, formatDateTime, formatTime } from "@/lib/utils";
import type { Message } from "@/types/entities";

const QUICK_EMOJI = ["👍", "✅", "🎉", "❤️", "👀"];

type ActiveDialog = "agenda" | "decision" | "pin" | null;

interface UpcomingMeeting {
  id: string;
  title: string;
  starts_at: string;
}

export function MessageItem({
  message,
  currentUserId,
  channelId,
  replyCount,
  onOpenThread,
  onChanged,
  isThreadReply = false,
  canConvert = true,
  isStaff = false,
}: {
  message: Message;
  currentUserId: string;
  channelId?: string;
  replyCount?: number;
  onOpenThread?: (rootId: string) => void;
  onChanged: () => void;
  isThreadReply?: boolean;
  canConvert?: boolean;
  isStaff?: boolean;
}) {
  const { toast } = useToast();
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const deleted = Boolean(message.deleted_at);
  const isAuthor = message.author_id === currentUserId;

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

  async function handleConvertTask() {
    const result = await convertMessageToTask(message.id);
    if (result.ok) {
      toast("Task created from this message.", {
        action: { label: "Open My Work", onClick: () => window.location.assign("/my-work") },
      });
    } else {
      toast(result.error ?? "Conversion failed.", { tone: "error" });
    }
  }

  async function openAgendaDialog() {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("meeting")
      .select("id, title, starts_at")
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(20);
    setMeetings((data as UpcomingMeeting[] | null) ?? []);
    setDialog("agenda");
  }

  async function handleAgendaSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const meetingId = new FormData(e.currentTarget).get("meetingId") as string;
    if (!meetingId) return;
    setSaving(true);
    const result = await convertMessageToAgendaItem(message.id, meetingId);
    setSaving(false);
    setDialog(null);
    if (result.ok) toast("Added to the meeting agenda.");
    else toast(result.error ?? "Could not add the agenda item.", { tone: "error" });
  }

  async function handleDecisionSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const detail = new FormData(e.currentTarget).get("detail") as string;
    setSaving(true);
    const result = await convertMessageToDecision(message.id, detail);
    setSaving(false);
    setDialog(null);
    if (result.ok) toast("Decision recorded in the decision log.");
    else toast(result.error ?? "Could not record the decision.", { tone: "error" });
  }

  async function handlePinSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!channelId) return;
    const title = new FormData(e.currentTarget).get("title") as string;
    setSaving(true);
    const result = await pinMessage(message.id, channelId, title);
    setSaving(false);
    setDialog(null);
    if (result.ok) {
      toast("Pinned to channel resources.");
      onChanged();
    } else {
      toast(result.error ?? "Could not pin.", { tone: "error" });
    }
  }

  async function handleSaveEdit() {
    if (!draft.trim() || draft === message.body) {
      setEditing(false);
      setDraft(message.body);
      return;
    }
    setSaving(true);
    const result = await editMessage({ messageId: message.id, body: draft });
    setSaving(false);
    if (!result.ok) {
      toast(result.error ?? "Edit failed.", { tone: "error" });
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function handleDelete() {
    if (!window.confirm("Delete this message? An audit marker is retained.")) return;
    const result = await deleteMessage(message.id);
    if (result.ok) onChanged();
    else toast(result.error ?? "Delete failed.", { tone: "error" });
  }

  function copyPermalink() {
    // Permission-checked permalink (P0-MSG-06): the target re-checks access.
    const base = channelId
      ? `/channels/${channelId}?message=${message.id}`
      : `/messages/${message.conversation_id}?message=${message.id}`;
    void navigator.clipboard.writeText(`${window.location.origin}${base}`);
    toast("Link copied. Access is re-checked when it's opened.");
  }

  const menuItems = [
    { label: "Copy link", onSelect: copyPermalink, icon: <Link2 className="size-4" aria-hidden /> },
    ...(isAuthor
      ? [
          {
            label: "Edit message",
            onSelect: () => setEditing(true),
            icon: <Pencil className="size-4" aria-hidden />,
          },
        ]
      : []),
    ...(canConvert
      ? [
          {
            label: "Create task",
            onSelect: handleConvertTask,
            icon: <ListPlus className="size-4" aria-hidden />,
          },
          {
            label: "Add to meeting agenda",
            onSelect: openAgendaDialog,
            icon: <CalendarPlus className="size-4" aria-hidden />,
          },
        ]
      : []),
    ...(canConvert && isStaff
      ? [
          {
            label: "Record as decision",
            onSelect: () => setDialog("decision"),
            icon: <Gavel className="size-4" aria-hidden />,
          },
          {
            label: "Pin to channel",
            onSelect: () => setDialog("pin"),
            icon: <Pin className="size-4" aria-hidden />,
          },
        ]
      : []),
    ...(isAuthor
      ? [
          {
            label: "Delete message",
            onSelect: handleDelete,
            icon: <Trash2 className="size-4" aria-hidden />,
            destructive: true,
          },
        ]
      : []),
  ];

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "group relative flex gap-2.5 px-4 py-2 hover:bg-surface-soft/50",
        isThreadReply && "py-1.5",
      )}
    >
      <Avatar
        name={message.author?.full_name ?? "Unknown"}
        src={message.author?.avatar_url}
        size={isThreadReply ? "sm" : "md"}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-2">
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
          {message.is_system ? <Badge tone="info">System</Badge> : null}
        </p>

        {deleted ? (
          <p className="text-[13.5px] text-muted italic">
            This message was deleted.
          </p>
        ) : editing ? (
          <div className="mt-1 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              aria-label="Edit message"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(message.body);
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSaveEdit();
                }
              }}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveEdit} loading={saving}>
                Save
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setDraft(message.body);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p
            className={cn(
              "text-[14px] break-words whitespace-pre-wrap",
              message.is_system && "text-muted",
            )}
          >
            {message.body}
          </p>
        )}

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

        {!isThreadReply && replyCount && replyCount > 0 && onOpenThread ? (
          <button
            type="button"
            onClick={() => onOpenThread(message.id)}
            className="mt-1.5 text-[12.5px] font-medium text-brand-fg hover:underline"
          >
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
      </div>

      {!deleted && !editing ? (
        <div className="absolute top-1 right-3 hidden items-center gap-0.5 rounded-(--radius-sm) border border-line bg-surface p-0.5 shadow-(--shadow-raise) group-focus-within:flex group-hover:flex">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              aria-label="Add reaction"
              aria-expanded={showEmoji}
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
          <Menu items={menuItems} label="Message actions" />
        </div>
      ) : null}

      {/* Add to agenda (P0-LINK-03) */}
      <Dialog
        open={dialog === "agenda"}
        onClose={() => setDialog(null)}
        title="Add to meeting agenda"
      >
        <form onSubmit={handleAgendaSubmit} className="space-y-4">
          <p className="rounded-(--radius-sm) bg-surface-soft px-3 py-2 text-[13px] text-muted">
            “{message.body.slice(0, 160)}
            {message.body.length > 160 ? "…" : ""}”
          </p>
          {meetings.length === 0 ? (
            <p className="text-[13.5px] text-muted">
              No upcoming meetings. Schedule one first, then convert this
              message into an agenda item.
            </p>
          ) : (
            <div>
              <Label htmlFor="agenda-meeting">Meeting</Label>
              <Select id="agenda-meeting" name="meetingId" required>
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {meeting.title} · {formatDateTime(meeting.starts_at)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={meetings.length === 0}>
              Add agenda item
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Record as decision (P0-LINK-04) */}
      <Dialog
        open={dialog === "decision"}
        onClose={() => setDialog(null)}
        title="Record decision"
      >
        <form onSubmit={handleDecisionSubmit} className="space-y-4">
          <p className="rounded-(--radius-sm) bg-surface-soft px-3 py-2 text-[13px] text-muted">
            “{message.body.slice(0, 160)}
            {message.body.length > 160 ? "…" : ""}”
          </p>
          <div>
            <Label htmlFor="decision-detail">
              Context <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea
              id="decision-detail"
              name="detail"
              rows={3}
              placeholder="Why was this decided, and what does it affect?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Record decision
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Pin to channel (P0-RES-02) */}
      <Dialog
        open={dialog === "pin"}
        onClose={() => setDialog(null)}
        title="Pin to channel resources"
      >
        <form onSubmit={handlePinSubmit} className="space-y-4">
          <div>
            <Label htmlFor="pin-title">Resource title</Label>
            <Input
              id="pin-title"
              name="title"
              required
              maxLength={200}
              defaultValue={message.body.split("\n")[0].slice(0, 80)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Pin resource
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
