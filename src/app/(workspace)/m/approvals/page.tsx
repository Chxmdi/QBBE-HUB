import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { getApprovalInbox } from "@/features/approvals/services/approval.queries";
import { mobileT } from "@/features/mobile/i18n";
import { ApprovalCard } from "@/features/mobile/components/approval-card";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: mobileT(await getLocale())("approvals.title") };
}

export default async function PhoneApprovals() {
  await requireSession();
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = mobileT(locale);
  const items = await getApprovalInbox();
  return (
    <div className="space-y-4">
      <h1 className="page-title">{t("approvals.title")}</h1>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("approvals.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <ApprovalCard
              key={item.id}
              id={item.id}
              title={item.title}
              requester={item.requester?.full_name ?? null}
              amount={item.amount_cents === null ? null : format.currency(item.amount_cents / 100)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
