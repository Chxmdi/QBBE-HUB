import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { activeTransport, recipientAllowlist } from "@/features/notifications/services/email-provider";
import {
  DELIVERY_STATUSES,
  getDeliveryOverview,
  isDeliveryStatus,
  type DeliveryStatus,
} from "@/features/notifications/services/email.queries";
import { requireAdminAal2 } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import { labelOr } from "@/features/admin/labels";

/**
 * Why an email was not sent, as the delivery rules record it: a code, or
 * `preference:<category>` / `digest-only:<mode>`. English shows the code as
 * it always has; an unknown one is shown as recorded.
 */
function suppressedReasonLabel(reason: string, t: TranslateFn): string {
  const [code, detail] = reason.split(/:(.*)/s);
  if (detail !== undefined && (code === "preference" || code === "digest-only")) {
    return t(`admin.email.reasons.${code}`, {
      detail: labelOr(t, `admin.email.categories.${detail}`, detail),
    });
  }
  return labelOr(t, `admin.email.reasons.${code}`, reason);
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.email.title") };
}
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<DeliveryStatus, "success" | "info" | "danger" | "neutral" | "warning"> = {
  sent: "success",
  queued: "info",
  sending: "info",
  bounced: "danger",
  failed: "danger",
  suppressed: "neutral",
};


/** Admin → Email: the delivery ledger, bounces included (NTF-002, §14.2). */
export default async function AdminEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminAal2();
  const t = await getT();
  const format = await getFormatters();
  const { status: statusParam } = await searchParams;
  const status = isDeliveryStatus(statusParam) ? statusParam : undefined;

  const { rows, counts, problemCount } = await getDeliveryOverview(status);
  const transport = activeTransport();
  const allowlist = recipientAllowlist();

  return (
    <div>
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.email.title")}
        description={t("admin.email.description")}
      />
      <AdminNav />

      <div className="space-y-8">
        {transport === "log" ? (
          <p className="card border-warning/40 bg-warning/8 px-4 py-3 text-[13.5px]">
            <strong className="font-semibold">{t("admin.email.noProvider")}</strong>{" "}
            {t("admin.email.noProviderBody1")}{" "}
            <code className="rounded bg-surface-soft px-1 py-0.5 text-[12.5px]">
              EMAIL_PROVIDER_API_KEY
            </code>{" "}
            {t("admin.email.and")}{" "}
            <code className="rounded bg-surface-soft px-1 py-0.5 text-[12.5px]">
              EMAIL_FROM_ADDRESS
            </code>{" "}
            {t("admin.email.noProviderBody2")}
          </p>
        ) : null}

        {allowlist ? (
          <p className="card border-info/40 bg-info/8 px-4 py-3 text-[13.5px]">
            <strong className="font-semibold">{t("admin.email.allowlist")}</strong>{" "}
            {t("admin.email.allowlistBody1", { list: allowlist.join(", ") })}{" "}
            <code className="rounded bg-surface-soft px-1 py-0.5 text-[12.5px]">
              EMAIL_RECIPIENT_ALLOWLIST
            </code>{" "}
            {t("admin.email.allowlistBody2")}
          </p>
        ) : null}

        {problemCount > 0 ? (
          <p className="card border-danger/40 bg-danger/8 px-4 py-3 text-[13.5px]">
            <strong className="font-semibold">
              {t(problemCount === 1 ? "admin.email.problemsOne" : "admin.email.problemsOther", {
                count: format.number(problemCount),
              })}
            </strong>{" "}
            {t("admin.email.problemsBody")}
          </p>
        ) : null}

        <section aria-labelledby="email-filter">
          <h2 id="email-filter" className="sr-only">
            {t("admin.email.filterHeading")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            <li>
              <FilterChip href="/admin/email" active={!status} label={t("admin.email.all")} />
            </li>
            {DELIVERY_STATUSES.map((candidate) => (
              <li key={candidate}>
                <FilterChip
                  href={`/admin/email?status=${candidate}`}
                  active={status === candidate}
                  label={t("admin.email.chip", {
                    status: t(`admin.email.statuses.${candidate}`),
                    count: format.number(counts[candidate]),
                  })}
                />
              </li>
            ))}
          </ul>
          {status ? (
            <p className="meta mt-2">{t(`admin.email.help.${status}`)}</p>
          ) : null}
        </section>

        <section aria-labelledby="email-deliveries">
          <h2 id="email-deliveries" className="section-heading mb-3">
            {t("admin.email.deliveries")}
          </h2>
          {rows.length === 0 ? (
            <EmptyState
              title={
                status
                  ? t("admin.email.nothingIn", { status: t(`admin.email.statuses.${status}`) })
                  : t("admin.email.noEmail")
              }
              description={
                status ? t("admin.email.noneInState") : t("admin.email.noneYet")
              }
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-soft/60">
                      <th scope="col" className="px-4 py-2.5 font-semibold">{t("admin.email.recipient")}</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">{t("admin.email.subject")}</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">{t("admin.email.status")}</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">{t("admin.email.when")}</th>
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
                            {labelOr(t, `admin.email.kinds.${row.kind}`, row.kind)} ·{" "}
                            {labelOr(t, `admin.email.categories.${row.category}`, row.category)}
                            {row.provider ? t("admin.email.via", { provider: row.provider }) : ""}
                            {row.attempt > 1 ? t("admin.email.attempt", { attempt: row.attempt }) : ""}
                          </span>
                          {row.lastError ? (
                            <span className="mt-1 block font-mono text-[12px] break-words text-danger-fg">
                              {row.lastError}
                            </span>
                          ) : null}
                          {row.suppressedReason ? (
                            <span className="meta mt-1 block">
                              {t("admin.email.suppressed", { reason: suppressedReasonLabel(row.suppressedReason, t) })}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONE[row.status]}>
                            {t(`admin.email.statuses.${row.status}`)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">
                          <span className="block">{format.relative(row.createdAt)}</span>
                          {row.sentAt ? (
                            <span className="meta">
                              {t("admin.email.sent", { when: format.dateTime(row.sentAt) })}
                            </span>
                          ) : row.scheduledFor ? (
                            <span className="meta">
                              {t("admin.email.heldUntil", {
                                when: format.dateTime(row.scheduledFor),
                              })}
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
