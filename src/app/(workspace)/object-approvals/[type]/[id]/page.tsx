import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { objectApprovalsEnabled } from "@/features/object-approvals/flag";
import { objectApprovalsT } from "@/features/object-approvals/i18n";
import { isApprovableType } from "@/features/object-approvals/contract";
import { getObjectApprovals } from "@/features/object-approvals/services/object-approval.queries";
import { ObjectApprovalPanel } from "@/features/object-approvals/components/object-approval-panel";
import { RequestApprovalForm } from "@/features/object-approvals/components/request-approval-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: objectApprovalsT(await getLocale())("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Approvals for one record of any approvable type, with the "Request approval" action. */
export default async function ObjectApprovalPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  if (!(await objectApprovalsEnabled())) notFound();
  const session = await requireSession();
  const { type, id } = await params;
  if (!isApprovableType(type) || !UUID.test(id)) notFound();
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = objectApprovalsT(locale);
  const found = await getObjectApprovals(type, id);
  if (!found) notFound();
  const waiting = found.approvals.some((a) => a.status === "pending");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={t(`kind.${type}`)}
        title={t("heading", { title: found.title })}
        actions={<Link href={found.href} className="text-sm text-brand-fg underline">{t("backToRecord")}</Link>}
      />
      <section aria-labelledby="oa-history" className="space-y-3">
        <h2 id="oa-history" className="section-heading">{t("history")}</h2>
        <ObjectApprovalPanel approvals={found.approvals} t={t} format={format} />
      </section>
      {waiting ? (
        <p className="text-sm text-muted">{t("request.waiting")}</p>
      ) : session.isStaff ? (
        <RequestApprovalForm type={type} id={id} />
      ) : null}
    </div>
  );
}
