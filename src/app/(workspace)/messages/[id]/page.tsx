import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/ui/avatar";
import { ChannelView } from "@/features/channels/components/channel-view";
import { CHANNEL_HISTORY_PAGE_SIZE } from "@/features/channels/history";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Message } from "@/types/entities";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

const MESSAGE_SELECT =
  "id, channel_id, conversation_id, thread_root_id, author_id, body, is_system, created_at, edited_at, deleted_at, " +
  "author:author_id(id, full_name, email, avatar_url, title, timezone), reactions:message_reaction(message_id, user_id, emoji)";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: conversation } = await supabase
    .from("conversation")
    .select("id, is_group, title, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!conversation) notFound();

  const [{ data: members }, { data: messages }] = await Promise.all([
    supabase
      .from("conversation_member")
      .select("user_id, user_profile:user_id(id, full_name, avatar_url)")
      .eq("conversation_id", id),
    supabase
      .from("message")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(CHANNEL_HISTORY_PAGE_SIZE),
  ]);

  type MemberRow = {
    user_id: string;
    user_profile: { id: string; full_name: string; avatar_url: string | null } | null;
  };
  const others = ((members ?? []) as unknown as MemberRow[])
    .filter((m) => m.user_id !== session.userId && m.user_profile)
    .map((m) => m.user_profile!);

  const title =
    conversation.title ?? (others.map((o) => o.full_name).join(", ") || "Just you");

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] flex-col md:-mx-8">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 md:px-6">
        <Link href="/messages" className="meta hover:text-brand-fg hover:underline">
          ← Messages
        </Link>
        <div className="flex items-center gap-2">
          {others[0] ? (
            <Avatar name={others[0].full_name} src={others[0].avatar_url} size="sm" />
          ) : null}
          <h1 className="text-[15px] font-semibold">{title}</h1>
        </div>
        <span className="meta ml-auto">
          Private to {(members ?? []).length} participants
        </span>
      </header>
      <Suspense fallback={<p className="px-4 py-6 text-[13px] text-muted">Loading conversation…</p>}>
        <ChannelView
          conversationId={id}
          currentUserId={session.userId}
          canPost
          initialMessages={[...((messages ?? []) as unknown as Message[])].reverse()}
          isStaff={session.isStaff}
        />
      </Suspense>
    </div>
  );
}
