import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { StartConversationDialog } from "@/features/channels/components/start-conversation-dialog";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Direct messages" };
export const dynamic = "force-dynamic";

interface ConversationListRow {
  conversation_id: string;
  last_read_at: string;
  conversation: {
    id: string;
    is_group: boolean;
    title: string | null;
    created_at: string;
  } | null;
}

export default async function MessagesPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const options = await getPickerOptions();

  const { data: memberships } = await supabase
    .from("conversation_member")
    .select(
      "conversation_id, last_read_at, conversation:conversation_id(id, is_group, title, created_at)",
    )
    .eq("user_id", session.userId);

  const rows = ((memberships ?? []) as unknown as ConversationListRow[]).filter(
    (r) => r.conversation,
  );

  // Resolve participant names + last message per conversation.
  const conversations = await Promise.all(
    rows.map(async (row) => {
      const [{ data: members }, { data: lastMessage }] = await Promise.all([
        supabase
          .from("conversation_member")
          .select("user_id, user_profile:user_id(id, full_name, avatar_url)")
          .eq("conversation_id", row.conversation_id),
        supabase
          .from("message")
          .select("body, created_at, author_id")
          .eq("conversation_id", row.conversation_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      type MemberRow = {
        user_id: string;
        user_profile: { id: string; full_name: string; avatar_url: string | null } | null;
      };
      const others = ((members ?? []) as unknown as MemberRow[])
        .filter((m) => m.user_id !== session.userId && m.user_profile)
        .map((m) => m.user_profile!);
      return {
        id: row.conversation_id,
        title:
          row.conversation!.title ??
          (others.map((o) => o.full_name).join(", ") || "Just you"),
        avatar: others[0] ?? null,
        lastMessage,
        unread: lastMessage
          ? new Date(lastMessage.created_at) > new Date(row.last_read_at) &&
            lastMessage.author_id !== session.userId
          : false,
      };
    }),
  );

  conversations.sort((a, b) => {
    const at = a.lastMessage?.created_at ?? "";
    const bt = b.lastMessage?.created_at ?? "";
    return bt.localeCompare(at);
  });

  return (
    <div>
      <PageHeader
        eyebrow="Communication"
        title="Direct messages"
        description="Private 1:1 and small-group conversations. Visibility is limited to participants."
        actions={<StartConversationDialog people={options.people.filter((p) => p.id !== session.userId)} />}
      />

      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageCircle />}
          title="No conversations yet"
          description="Start a direct message with a colleague — it stays private to the participants."
        />
      ) : (
        <ul className="card divide-y divide-line">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/messages/${conversation.id}`}
                className="interactive-row flex items-center gap-3 px-4 py-3"
              >
                <Avatar
                  name={conversation.avatar?.full_name ?? conversation.title}
                  src={conversation.avatar?.avatar_url}
                  size="md"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      conversation.unread
                        ? "block truncate text-[14px] font-semibold"
                        : "block truncate text-[14px] font-medium"
                    }
                  >
                    {conversation.title}
                  </span>
                  {conversation.lastMessage ? (
                    <span className="meta block truncate">
                      {conversation.lastMessage.body}
                    </span>
                  ) : null}
                </span>
                {conversation.unread ? (
                  <span
                    aria-label="Unread messages"
                    className="size-2 rounded-full bg-brand"
                  />
                ) : null}
                {conversation.lastMessage ? (
                  <span className="meta whitespace-nowrap">
                    {relativeTime(conversation.lastMessage.created_at)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
