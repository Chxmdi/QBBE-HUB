import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Admin → Email reads the delivery ledger as the signed-in administrator, so
 * RLS decides what is visible. Counts come from head-only queries rather than
 * loading rows the page will not render.
 */

export const DELIVERY_STATUSES = [
  "sent",
  "queued",
  "sending",
  "bounced",
  "failed",
  "suppressed",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface DeliveryRow {
  id: string;
  recipient: string;
  subject: string;
  category: string;
  kind: string;
  status: DeliveryStatus;
  suppressedReason: string | null;
  provider: string | null;
  attempt: number;
  lastError: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  recipientName: string | null;
}

export function isDeliveryStatus(value: string | undefined): value is DeliveryStatus {
  return (
    value !== undefined && (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}

export async function getDeliveryOverview(status?: DeliveryStatus): Promise<{
  rows: DeliveryRow[];
  counts: Record<DeliveryStatus, number>;
  problemCount: number;
}> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("email_delivery")
    .select(
      "id, recipient, subject, category, kind, status, suppressed_reason, provider, attempt, last_error, scheduled_for, sent_at, created_at, recipient_profile:recipient_user_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) query = query.eq("status", status);

  const [listResult, ...countResults] = await Promise.all([
    query,
    ...DELIVERY_STATUSES.map((candidate) =>
      supabase
        .from("email_delivery")
        .select("id", { count: "exact", head: true })
        .eq("status", candidate),
    ),
  ]);

  const rows = ((listResult.data ?? []) as unknown as {
    id: string;
    recipient: string;
    subject: string;
    category: string;
    kind: string;
    status: DeliveryStatus;
    suppressed_reason: string | null;
    provider: string | null;
    attempt: number;
    last_error: string | null;
    scheduled_for: string | null;
    sent_at: string | null;
    created_at: string;
    recipient_profile: { full_name: string } | null;
  }[]).map((row) => ({
    id: row.id,
    recipient: row.recipient,
    subject: row.subject,
    category: row.category,
    kind: row.kind,
    status: row.status,
    suppressedReason: row.suppressed_reason,
    provider: row.provider,
    attempt: row.attempt,
    lastError: row.last_error,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    recipientName: row.recipient_profile?.full_name ?? null,
  }));

  const counts = Object.fromEntries(
    DELIVERY_STATUSES.map((candidate, index) => [
      candidate,
      countResults[index]?.count ?? 0,
    ]),
  ) as Record<DeliveryStatus, number>;

  return {
    rows,
    counts,
    problemCount: counts.bounced + counts.failed,
  };
}
