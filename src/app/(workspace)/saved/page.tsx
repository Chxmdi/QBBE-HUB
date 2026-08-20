import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Saved messages" };
export const dynamic = "force-dynamic";

interface SavedMessageRow {
  created_at: string;
  message: {
    id: string;
    body: string;
    created_at: string;
    deleted_at: string | null;
    channel_id: string | null;
    conversation_id: string | null;
    author: { full_name: string; avatar_url: string | null } | null;
    channel: { id: string; slug: string } | null;
    conversation: { id: string; title: string | null } | null;
  } | null;
}

function messageHref(message: NonNullable<SavedMessageRow["message"]>): string | null {
  if (message.channel) return `/channels/${message.channel.id}?message=${message.id}`;
  if (message.conversation) return `/messages/${message.conversation.id}?message=${message.id}`;
  return null;
}

export default async function SavedMessagesPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("saved_message")
    .select(
      "created_at, message:message_id(id, body, created_at, deleted_at, channel_id, conversation_id, author:author_id(full_name, avatar_url), channel:channel_id(id, slug), conversation:conversation_id(id, title))",
    )
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false });

  const saved = (data ?? []) as unknown as SavedMessageRow[];
  const visible = saved.filter((row) => row.message);

  return (
    <div>
      <PageHeader
        eyebrow="Communication"
        title="Saved messages"
        description="Keep important conversations close at hand. Access is checked again each time you open a message."
      />
      {visible.length === 0 ? (
        <EmptyState
          icon={<Bookmark />}
          title="No saved messages"
          description="Use the message actions menu in a channel or direct message to save something for later."
        />
      ) : (
        <ul className="card divide-y divide-line">
          {visible.map((row) => {
            const message = row.message!;
            const href = messageHref(message);
            const location = message.channel
              ? `#${message.channel.slug}`
              : message.conversation?.title || "Direct message";
            const content = (
              <>
                <Avatar
                  name={message.author?.full_name ?? "Unknown"}
                  src={message.author?.avatar_url}
                  size="md"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[14px] font-semibold">
                      {message.author?.full_name ?? "Unknown"}
                    </span>
                    <span className="meta">{location} · {formatDateTime(message.created_at)}</span>
                  </span>
                  <span className="mt-0.5 block whitespace-pre-wrap text-[13.5px] text-ink">
                    {message.deleted_at ? "This message was deleted." : message.body}
                  </span>
                </span>
              </>
            );
            return (
              <li key={message.id}>
                {href ? (
                  <Link href={href} className="interactive-row flex gap-3 px-4 py-3">
                    {content}
                  </Link>
                ) : (
                  <div className="flex gap-3 px-4 py-3 opacity-70">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
