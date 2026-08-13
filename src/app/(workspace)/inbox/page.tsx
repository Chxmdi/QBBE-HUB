import type { Metadata } from "next";
import Link from "next/link";
import { Inbox as InboxIcon, Mail } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkReadButton } from "@/features/inbox/components/mark-read-button";
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
] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const filter = params.filter ?? "all";
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("notification")
    .select("id, category, title, body, link, urgency, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter !== "all") query = query.eq("category", filter);

  const [{ data: notifications }, { data: gmailConnection }] = await Promise.all([
    query,
    session.isAdmin
      ? supabase
          .from("integration_connection")
          .select("status, last_sync_at")
          .eq("provider", "gmail")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const items = (notifications ?? []) as Notification[];
  const unread = items.filter((n) => !n.read_at);

  return (
    <div>
      <PageHeader
        eyebrow="Unified triage"
        title="Inbox"
        description="Platform notifications, mentions, assignments, replies, and announcements in one place."
      />

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
          {items.length === 0 ? (
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
                  <span
                    aria-label={notification.read_at ? "Read" : "Unread"}
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      notification.read_at ? "bg-transparent" : "bg-brand",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    {notification.link ? (
                      <Link
                        href={notification.link}
                        className="text-[13.5px] font-medium hover:text-brand"
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
              </>
            ) : (
              <>
                <Badge tone="neutral">Not connected</Badge>
                <p className="mt-2.5 text-[13px] text-muted">
                  Gmail integration requires a QBBE-approved Google OAuth
                  configuration. Once the administrator sets the Google
                  credentials in the environment and completes the consent
                  review, connected email will appear alongside platform
                  notifications here.
                </p>
                <p className="meta mt-2">
                  See docs/runbooks/integrations.md for setup.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
