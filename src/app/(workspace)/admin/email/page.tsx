import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { activeTransport } from "@/features/notifications/services/email-provider";
import {
  DELIVERY_STATUSES,
  getDeliveryOverview,
  isDeliveryStatus,
  type DeliveryStatus,
} from "@/features/notifications/services/email.queries";
import { requireAdmin } from "@/lib/auth";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Email" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<DeliveryStatus, "success" | "info" | "danger" | "neutral" | "warning"> = {
  sent: "success",
  queued: "info",
  sending: "info",
  bounced: "danger",
  failed: "danger",
  suppressed: "neutral",
};

const STATUS_HELP: Record<DeliveryStatus, string> = {
  sent: "Handed to the provider.",
  queued: "Waiting for the next drain, or held for quiet hours.",
  sending: "In flight right now.",
  bounced: "The provider rejected the address or the message. It will not arrive.",
  failed: "Out of retry attempts. Dead-lettered for review.",
  suppressed: "Not sent, by the recipient's own preference.",
};

/** Admin → Email: the delivery ledger, bounces included (NTF-002, §14.2). */
export default async function AdminEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status: statusParam } = await searchParams;
  const status = isDeliveryStatus(statusParam) ? statusParam : undefined;

  const { rows, counts, problemCount } = await getDeliveryOverview(status);
  const transport = activeTransport();

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Email"
        description="Every notification email this workspace has attempted, and what became of it."
      />
      <AdminNav />

      <div className="space-y-8">
        {transport === "log" ? (
          <p className="card border-warning/40 bg-warning/8 px-4 py-3 text-[13.5px]">
            <strong className="font-semibold">No email provider is configured.</strong>{" "}
            Deliveries are being recorded and logged, not sent. Set{" "}
            <code className="rounded bg-surface-soft px-1 py-0.5 text-[12.5px]">
              EMAIL_PROVIDER_API_KEY
            </code>{" "}
            and{" "}
            <code className="rounded bg-surface-soft px-1 py-0.5 text-[12.5px]">
              EMAIL_FROM_ADDRESS
            </code>{" "}
            for a verified QBBE sender domain to start real delivery.
          </p>
        ) : null}

        {problemCount > 0 ? (
          <p className="card border-danger/40 bg-danger/8 px-4 py-3 text-[13.5px]">
            <strong className="font-semibold">
              {problemCount} {problemCount === 1 ? "message" : "messages"} did not arrive.
            </strong>{" "}
            Bounced and failed deliveries are listed below with the provider&#39;s
            reason.
          </p>
        ) : null}

        <section aria-labelledby="email-filter">
          <h2 id="email-filter" className="sr-only">
            Filter deliveries
          </h2>
          <ul className="flex flex-wrap gap-2">
            <li>
              <FilterChip href="/admin/email" active={!status} label="All" />
            </li>
            {DELIVERY_STATUSES.map((candidate) => (
              <li key={candidate}>
                <FilterChip
                  href={`/admin/email?status=${candidate}`}
                  active={status === candidate}
                  label={`${candidate} ${counts[candidate]}`}
                />
              </li>
            ))}
          </ul>
          {status ? (
            <p className="meta mt-2">{STATUS_HELP[status]}</p>
          ) : null}
        </section>

        <section aria-labelledby="email-deliveries">
          <h2 id="email-deliveries" className="section-heading mb-3">
            Deliveries
          </h2>
          {rows.length === 0 ? (
            <EmptyState
              title={status ? `Nothing ${status}` : "No email yet"}
              description={
                status
                  ? "No delivery is in this state right now."
                  : "Deliveries appear here as soon as a notification is created and the drain job runs."
              }
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-soft/60">
                      <th scope="col" className="px-4 py-2.5 font-semibold">Recipient</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Subject</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-line last:border-b-0 align-top">
                        <td className="px-4 py-3">
                          <span className="block font-medium">
                            {row.recipientName ?? row.recipient}
                          </span>
                          <span className="meta">{row.recipient}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block">{row.subject}</span>
                          <span className="meta">
                            {row.kind} · {row.category}
                            {row.provider ? ` · via ${row.provider}` : ""}
                            {row.attempt > 1 ? ` · attempt ${row.attempt}` : ""}
                          </span>
                          {row.lastError ? (
                            <span className="mt-1 block font-mono text-[12px] break-words text-danger-fg">
                              {row.lastError}
                            </span>
                          ) : null}
                          {row.suppressedReason ? (
                            <span className="meta mt-1 block">
                              suppressed: {row.suppressedReason}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">
                          <span className="block">{relativeTime(row.createdAt)}</span>
                          {row.sentAt ? (
                            <span className="meta">sent {formatDateTime(row.sentAt)}</span>
                          ) : row.scheduledFor ? (
                            <span className="meta">
                              held until {formatDateTime(row.scheduledFor)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium",
        "transition-colors duration-(--duration-fast)",
        active
          ? "border-brand bg-brand-soft text-brand-fg"
          : "border-line text-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
