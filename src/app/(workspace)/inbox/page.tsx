import type { Metadata } from "next";
import Link from "next/link";
import { Inbox as InboxIcon, Mail } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkReadButton } from "@/features/inbox/components/mark-read-button";
import { GmailReplyForm } from "@/features/inbox/components/gmail-reply-form";
import { getGmailMessageDetail } from "@/features/inbox/services/gmail.commands";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn, relativeTime } from "@/lib/utils";
import type { Notification } from "@/types/entities";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "mention", label: "Mentions" },
  { key: "assignment", label: "Assignments" },
  { key: "reply", label: "Replies" },
  { key: "announcement", label: "Announcements" },
  { key: "mail", label: "Mail" },
] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; google_error?: string; message?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const filter = params.filter ?? "all";
  const supabase = await createSupabaseServerClient();
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );

  let query = supabase
    .from("notification")
    .select("id, category, title, body, link, urgency, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter !== "all" && filter !== "mail") query = query.eq("category", filter);

  const [{ data: notifications }, { data: gmailConnection }, { data: mail }] = await Promise.all([
    filter === "mail" ? Promise.resolve({ data: [] }) : query,
    supabase
      .from("integration_connection")
      .select("status, last_sync_at, last_error")
      .eq("provider", "gmail")
      .eq("user_id", session.userId)
      .maybeSingle(),
    filter === "mail"
      ? supabase
          .from("gmail_message")
          .select("id, external_id, subject, snippet, from_address, received_at, thread_id")
          .eq("user_id", session.userId)
          .order("received_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  const items = (notifications ?? []) as Notification[];
  const unread = items.filter((n) => !n.read_at);
  const selectedMail = filter === "mail" && params.message
    ? await getGmailMessageDetail(params.message)
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Unified triage"
        title="Inbox"
        description="Platform notifications, mentions, assignments, replies, and announcements in one place."
      />
      {params.google_error ? (
        <p role="alert" className="mb-4 rounded-(--radius-sm) bg-danger/10 px-3 py-2 text-[13px] text-danger-fg">
          {params.google_error}
        </p>
      ) : null}

      {/* Source filters (P0-INB-01) */}
      <nav aria-label="Inbox filters" className="mb-5 flex flex-wrap gap-1.5">
        {CATEGORIES.map((category) => (
          <Link
            key={category.key}
            href={category.key === "all" ? "/inbox" : `/inbox?filter=${category.key}`}
            aria-current={filter === category.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
              filter === category.key
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {category.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_320px]">
        <section aria-label="Notifications">
          {filter === "mail" ? (
            gmailConnection?.status !== "connected" ? (
              <EmptyState
                icon={<Mail />}
                title="Gmail is not connected"
                description={
                  googleConfigured
                    ? "Connect your QBBE Google account to list mail and securely reply without storing message bodies in QBBE Hub."
                    : "Gmail stays disconnected until an administrator sets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and the redirect URI. This is not a fake inbox."
                }
              />
            ) : (mail ?? []).length === 0 ? (
              <EmptyState
                icon={<Mail />}
                title="No mail synced yet"
                description="After a successful Gmail sync, thread metadata appears here. Message bodies are not stored in logs."
              />
            ) : (
              <ul className="card divide-y divide-line">
                {((mail ?? []) as { id: string; external_id: string; subject: string | null; snippet: string | null; from_address: string | null; received_at: string | null }[]).map(
                  (row) => (
                    <li key={row.id} className="px-4 py-3">
                      <Link href={`/inbox?filter=mail&message=${encodeURIComponent(row.external_id)}`} className="text-[13.5px] font-medium hover:text-brand-fg">{row.subject ?? "(no subject)"}</Link>
                      <p className="meta truncate">{row.from_address} · {row.snippet}</p>
                    </li>
                  ),
                )}
              </ul>
            )
          ) : items.length === 0 ? (
            <EmptyState
              icon={<InboxIcon />}
              title="Inbox zero"
              description="Notifications about mentions, assignments, replies, and announcements will arrive here."
            />
          ) : (
            <ul className="card divide-y divide-line">
              {items.map((notification) => (
                <li
                  key={notification.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3",
                    !notification.read_at && "bg-brand-soft/30",
                  )}
                >
                  {/* aria-label is ignored on a bare span, so read/unread was
                      carried by the dot's colour alone. */}
                  {!notification.read_at ? (
                    <span className="sr-only">Unread. </span>
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      notification.read_at ? "bg-transparent" : "bg-brand",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    {notification.link ? (
                      <Link
                        href={notification.link}
                        className="text-[13.5px] font-medium hover:text-brand-fg"
                      >
                        {notification.title}
                      </Link>
                    ) : (
                      <p className="text-[13.5px] font-medium">{notification.title}</p>
                    )}
                    {notification.body ? (
                      <p className="meta truncate">{notification.body}</p>
                    ) : null}
                    <p className="meta mt-0.5 flex items-center gap-2">
                      <Badge tone="neutral">{notification.category}</Badge>
                      {relativeTime(notification.created_at)}
                    </p>
                  </div>
                  {!notification.read_at ? (
                    <MarkReadButton notificationId={notification.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {selectedMail ? (
            <article className="card mt-5 p-5">
              <p className="text-[15px] font-semibold">{selectedMail.subject ?? "(no subject)"}</p>
              <p className="meta mt-1">From: {selectedMail.from ?? "Unknown"} · To: {selectedMail.to ?? "Unknown"}</p>
              <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed">{selectedMail.body || "No plain-text body was supplied by Gmail."}</pre>
              {selectedMail.from ? <GmailReplyForm to={selectedMail.from} subject={selectedMail.subject ?? ""} threadId={selectedMail.threadId} messageId={selectedMail.messageId} /> : null}
            </article>
          ) : null}
          {unread.length > 0 ? (
            <p className="meta mt-3">
              {unread.length} unread of {items.length} shown
            </p>
          ) : null}
        </section>

        {/* Gmail integration status — honest state, no misleading stubs
            (P0-GML-01, P0-UX rule §7.1) */}
        <aside aria-label="Connected email">
          <div className="card p-5">
            <p className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
              <Mail className="size-4 text-muted" aria-hidden />
              Gmail
            </p>
            {gmailConnection?.status === "connected" ? (
              <>
                <Badge tone="success">Connected</Badge>
                <p className="meta mt-2">
                  Last sync:{" "}
                  {gmailConnection.last_sync_at
                    ? relativeTime(gmailConnection.last_sync_at)
                    : "never"}
                </p>
                {gmailConnection.last_error ? (
                  <p className="mt-2 text-[13px] text-warning-fg">
                    Reconnect required: {gmailConnection.last_error}
                  </p>
                ) : null}
                <p className="meta mt-2">Open a synced message to read it on demand and reply through Gmail. Existing read-only connections must reconnect to grant send permission.</p>
              </>
            ) : (
              <>
                <Badge tone="neutral">Not connected</Badge>
                <p className="mt-2.5 text-[13px] text-muted">
                  {googleConfigured
                    ? "Connect Gmail to list mail and send/reply from a selected message."
                    : "Gmail integration requires a QBBE-approved Google OAuth configuration. Once credentials exist, Connect appears here."}
                </p>
                {googleConfigured ? (
                  <a
                    href="/api/integrations/google/start?provider=gmail"
                    className="mt-3 inline-flex h-9 items-center rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-strong"
                  >
                    Connect Gmail
                  </a>
                ) : (
                  <p className="meta mt-2">See docs/runbooks/integrations.md for setup.</p>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
