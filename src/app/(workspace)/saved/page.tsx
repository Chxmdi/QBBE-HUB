import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("shell.saved.title") };
}
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
  const t = await getT();
  const format = await getFormatters();
  const supabase = await createSupabasePageClient();
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
        eyebrow={t("shell.saved.eyebrow")}
        title={t("shell.saved.title")}
        description={t("shell.saved.description")}
      />
      {visible.length === 0 ? (
        <EmptyState
          icon={<Bookmark />}
          title={t("shell.saved.emptyTitle")}
          description={t("shell.saved.emptyBody")}
        />
      ) : (
        <ul className="card divide-y divide-line">
          {visible.map((row) => {
            const message = row.message!;
            const href = messageHref(message);
            const location = message.channel
              ? `#${message.channel.slug}`
              : message.conversation?.title || t("shell.saved.directMessage");
            const content = (
              <>
                <Avatar
                  name={message.author?.full_name ?? t("shell.saved.unknown")}
                  src={message.author?.avatar_url}
                  size="md"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[14px] font-semibold">
                      {message.author?.full_name ?? t("shell.saved.unknown")}
                    </span>
                    <span className="meta">{location} · {format.dateTime(message.created_at)}</span>
                  </span>
                  <span className="mt-0.5 block whitespace-pre-wrap text-[13.5px] text-ink">
                    {message.deleted_at ? t("shell.saved.deleted") : message.body}
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
