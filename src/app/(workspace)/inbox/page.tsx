import type { Metadata } from "next";
import Link from "next/link";
import { Inbox as InboxIcon, Mail } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkReadButton } from "@/features/inbox/components/mark-read-button";
import { GmailComposeForm } from "@/features/inbox/components/gmail-compose-form";
import { GmailReplyForm } from "@/features/inbox/components/gmail-reply-form";
import { getGmailMessageDetail } from "@/features/inbox/services/gmail.commands";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { cn } from "@/lib/utils";
import { getFormatters, getT } from "@/lib/i18n/server";
import { inboxItemVisible } from "@/features/notifications/services/mute";
import type { Notification } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("inbox.title") };
}
export const dynamic = "force-dynamic";

const CATEGORIES = [
  "all",
  "mention",
  "assignment",
  "reply",
  "due_date",
  "approval",
  "decision",
  "announcement",
  "mail",
] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; google_error?: string; message?: string }>;
}) {
  const session = await requireSession();
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const params = await searchParams;
  const filter = params.filter ?? "all";
  const supabase = await createSupabasePageClient();
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );

  let query = supabase
    .from("notification")
    .select("id, category, title, body, link, urgency, read_at, created_at, project_id, thread_id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter !== "all" && filter !== "mail") query = query.eq("category", filter);

  const [{ data: notifications }, { data: gmailConnection }, { data: mail }, { data: prefs }] = await Promise.all([
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
    supabase
      .from("notification_preference")
      .select("muted_project_ids, muted_thread_ids")
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);

  const mutedProjects = (prefs?.muted_project_ids as string[] | null) ?? [];
  const mutedThreads = (prefs?.muted_thread_ids as string[] | null) ?? [];
  const items = ((notifications ?? []) as (Notification & {
    project_id?: string | null;
    thread_id?: string | null;
  })[]).filter((item) =>
    inboxItemVisible({
      category: item.category,
      urgency: item.urgency,
      projectId: item.project_id,
      threadId: item.thread_id,
      mutedProjectIds: mutedProjects,
      mutedThreadIds: mutedThreads,
    }),
  );
  const unread = items.filter((n) => !n.read_at);
  const selectedMail = filter === "mail" && params.message
    ? await getGmailMessageDetail(params.message)
    : null;

  return (
    <div>
      <PageHeader
        eyebrow={t("inbox.eyebrow")}
        title={t("inbox.title")}
        description={t("inbox.description")}
      />
      {params.google_error ? (
        <p role="alert" className="mb-4 rounded-(--radius-sm) bg-danger/10 px-3 py-2 text-[13px] text-danger-fg">
          {params.google_error}
        </p>
      ) : null}

      {/* Source filters (P0-INB-01) */}
      <nav aria-label={t("inbox.filtersLabel")} className="mb-5 flex flex-wrap gap-1.5">
        {CATEGORIES.map((category) => (
          <Link
            key={category}
            href={category === "all" ? "/inbox" : `/inbox?filter=${category}`}
            aria-current={filter === category ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
              filter === category
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {t(`inbox.filters.${category}`)}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_320px]">
        <section aria-label={t("inbox.notificationsLabel")}>
          {filter === "mail" && gmailConnection?.status === "connected" ? <GmailComposeForm /> : null}
          {filter === "mail" ? (
            gmailConnection?.status !== "connected" ? (
              <EmptyState
                icon={<Mail />}
                title={t("inbox.gmailNotConnectedTitle")}
                description={
                  googleConfigured
                    ? t("inbox.gmailConnectPrompt")
                    : t("inbox.gmailNotConfigured")
                }
              />
            ) : (mail ?? []).length === 0 ? (
              <EmptyState
                icon={<Mail />}
                title={t("inbox.noMailTitle")}
                description={t("inbox.noMailBody")}
              />
            ) : (
              <ul className="card divide-y divide-line">
                {((mail ?? []) as { id: string; external_id: string; subject: string | null; snippet: string | null; from_address: string | null; received_at: string | null }[]).map(
                  (row) => (
                    <li key={row.id} className="px-4 py-3">
                      <Link href={`/inbox?filter=mail&message=${encodeURIComponent(row.external_id)}`} className="text-[13.5px] font-medium hover:text-brand-fg">{row.subject ?? t("common.noSubject")}</Link>
                      <p className="meta truncate">{row.from_address} · {row.snippet}</p>
                    </li>
                  ),
                )}
              </ul>
            )
          ) : items.length === 0 ? (
            <EmptyState
              icon={<InboxIcon />}
              title={t("inbox.zeroTitle")}
              description={t("inbox.zeroBody")}
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
                    <span className="sr-only">{t("common.unreadPrefix")}</span>
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
                      {format.relative(notification.created_at)}
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
              <p className="text-[15px] font-semibold">{selectedMail.subject ?? t("common.noSubject")}</p>
              <p className="meta mt-1">{t("inbox.fromTo", { from: selectedMail.from ?? t("common.unknown"), to: selectedMail.to ?? t("common.unknown") })}</p>
              <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed">{selectedMail.body || t("inbox.noBody")}</pre>
              {selectedMail.from ? <GmailReplyForm to={selectedMail.from} subject={selectedMail.subject ?? ""} threadId={selectedMail.threadId} messageId={selectedMail.messageId} /> : null}
            </article>
          ) : null}
          {unread.length > 0 ? (
            <p className="meta mt-3">
              {t("inbox.unreadSummary", { unread: unread.length, shown: items.length })}
            </p>
          ) : null}
        </section>

        {/* Gmail integration status — honest state, no misleading stubs
            (P0-GML-01, P0-UX rule §7.1) */}
        <aside aria-label={t("inbox.connectedEmail")}>
          <div className="card p-5">
            <p className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
              <Mail className="size-4 text-muted" aria-hidden />
              Gmail
            </p>
            {gmailConnection?.status === "connected" ? (
              <>
                <Badge tone="success">{t("inbox.connected")}</Badge>
                <p className="meta mt-2">
                  {t("inbox.lastSync", {
                    when: gmailConnection.last_sync_at
                      ? format.relative(gmailConnection.last_sync_at)
                      : t("common.never"),
                  })}
                </p>
                {gmailConnection.last_error ? (
                  <p className="mt-2 text-[13px] text-warning-fg">
                    {t("inbox.reconnectRequired", { error: gmailConnection.last_error })}
                  </p>
                ) : null}
                <p className="meta mt-2">{t("inbox.connectedHelp")}</p>
              </>
            ) : (
              <>
                <Badge tone="neutral">{t("inbox.notConnected")}</Badge>
                <p className="mt-2.5 text-[13px] text-muted">
                  {googleConfigured
                    ? t("inbox.connectHelp")
                    : t("inbox.configHelp")}
                </p>
                {googleConfigured ? (
                  <a
                    href="/api/integrations/google/start?provider=gmail"
                    className="mt-3 inline-flex h-9 items-center rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-strong"
                  >
                    {t("inbox.connectGmail")}
                  </a>
                ) : (
                  <p className="meta mt-2">{t("inbox.setupDocs")}</p>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
