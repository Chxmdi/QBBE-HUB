import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { CrmContactDialog } from "@/features/crm/components/crm-contact-dialog";
import { CrmTabs } from "@/features/crm/components/crm-tabs";
import { EraseContactButton } from "@/features/crm/components/erase-contact-button";
import { SupporterOrganizationForm } from "@/features/crm/components/supporter-organization-form";
import {
  contactSourceLabel,
  interactionTypeLabel,
  zeffyCategoryLabel,
  zeffyIntervalLabel,
  zeffyKindLabel,
} from "@/features/crm/labels";
import { recordSupporterInteraction } from "@/features/crm/services/supporter.commands";
import { getSupporter, getSupporterTotals } from "@/features/crm/services/supporter.queries";
import { requireSession, NO_ACCESS_REDIRECT } from "@/lib/auth";
import { getFormatters, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.supporter.metaTitle") };
}
export const dynamic = "force-dynamic";

const INTERACTION_TYPES = ["note", "call", "email", "meeting", "message", "other"] as const;

export default async function SupporterPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.isStaff) redirect(NO_ACCESS_REDIRECT);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [t, format, supporter] = await Promise.all([getT(), getFormatters(), getSupporter(id)]);
  if (!supporter) notFound();
  const { contact, activity, interactions, organizations } = supporter;
  // Finance readers only; anyone else is refused and sees no amounts.
  const totals = (await getSupporterTotals(session.organizationId, contact.id))?.get(contact.id) ?? null;
  const finance = totals !== null || activity.some((row) => row.amount_cents !== null);
  const money = (cents: number, currency: string | null) =>
    format.currency(cents / 100, (currency ?? "cad").toUpperCase());

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: t("crm.title"), href: "/crm" },
          { label: t("crm.supporters.title"), href: "/crm/supporters" },
          { label: contact.full_name },
        ]}
      />
      <PageHeader
        eyebrow={contactSourceLabel(contact.source, t)}
        title={contact.full_name}
        description={contact.role_title ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <CrmContactDialog contact={contact} />
            {session.isAdmin ? <EraseContactButton contactId={contact.id} name={contact.full_name} /> : null}
          </div>
        }
      />
      <CrmTabs active="supporters" />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="supporter-zeffy">
            <h2 id="supporter-zeffy" className="section-heading mb-3">
              {t("crm.supporter.zeffyHeading")}
            </h2>
            {!contact.zeffy_contact_id ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("crm.supporter.notLinked")}</p>
            ) : activity.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("crm.supporter.zeffyEmpty")}</p>
            ) : (
              <DataTable minWidth={finance ? "760px" : "560px"}>
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-muted">
                    <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporter.date")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporter.campaign")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporter.what")}</th>
                    {finance ? (
                      <>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("crm.supporter.amount")}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporter.receipt")}</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {activity.map((row) => (
                    <tr key={row.zeffy_id}>
                      <td className="px-3 py-2.5 whitespace-nowrap">{format.date(row.paid_at, session.timeZone)}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium">{row.campaign_title ?? "—"}</span>
                        {row.campaign_category ? (
                          <p className="meta">{zeffyCategoryLabel(row.campaign_category, t)}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {row.item_kinds.map((code) => (
                            <Badge key={code} tone="neutral">{zeffyKindLabel(code, t)}</Badge>
                          ))}
                          {row.is_recurring && row.recurring_interval ? (
                            <Badge tone="brand">{t("crm.supporter.recurring", { interval: zeffyIntervalLabel(row.recurring_interval, t) })}</Badge>
                          ) : null}
                          {row.refund_status === "full" ? <Badge tone="warning">{t("crm.supporter.refunded")}</Badge> : null}
                          {row.refund_status === "partial" ? (
                            <Badge tone="warning">
                              {t("crm.supporter.partlyRefunded", {
                                amount: row.refunded_cents !== null ? money(row.refunded_cents, row.currency) : "—",
                              })}
                            </Badge>
                          ) : null}
                          {row.dispute_status ? <Badge tone="danger">{t("crm.supporter.disputed")}</Badge> : null}
                        </div>
                      </td>
                      {finance ? (
                        <>
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                            {row.amount_cents !== null ? money(row.amount_cents, row.currency) : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            {row.receipt_url ? (
                              <a href={row.receipt_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-fg">
                                {t("crm.supporter.receiptLink")}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>

          <section aria-labelledby="supporter-notes">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="supporter-notes" className="section-heading">
                {t("crm.supporter.notesHeading")}
              </h2>
              <EntityFormDialog
                triggerLabel={t("crm.supporter.addNote")}
                triggerVariant="secondary"
                title={t("crm.supporter.addNote")}
                submitLabel={t("crm.supporter.noteSubmit")}
                action={recordSupporterInteraction}
                extraValues={{ contactId: contact.id }}
                fields={[
                  {
                    name: "interactionType",
                    label: t("crm.supporter.noteType"),
                    type: "select",
                    required: true,
                    options: INTERACTION_TYPES.map((code) => ({ value: code, label: interactionTypeLabel(code, t) })),
                  },
                  { name: "summary", label: t("crm.supporter.noteSummary"), type: "textarea", required: true },
                ]}
              />
            </div>
            {interactions.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("crm.supporter.notesEmpty")}</p>
            ) : (
              <ul className="card divide-y divide-line">
                {interactions.map((item) => (
                  <li key={item.id} className="px-4 py-3">
                    <p className="meta">
                      {interactionTypeLabel(item.interaction_type, t)} · {format.dateTime(item.occurred_at, session.timeZone)}
                      {item.owner ? ` · ${item.owner.full_name}` : ""}
                    </p>
                    <p className="mt-1 text-[13.5px] whitespace-pre-wrap">{item.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="supporter-details" className="card p-4">
            <h2 id="supporter-details" className="section-heading mb-3">
              {t("crm.supporter.details")}
            </h2>
            <dl className="space-y-2 text-[13.5px]">
              <div>
                <dt className="meta">{t("crm.supporter.email")}</dt>
                <dd>{contact.email ? <a href={`mailto:${contact.email}`} className="underline">{contact.email}</a> : "—"}</dd>
              </div>
              <div>
                <dt className="meta">{t("crm.supporter.phone")}</dt>
                <dd>{contact.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="meta">{t("crm.supporter.source")}</dt>
                <dd>{contactSourceLabel(contact.source, t)}</dd>
              </div>
              <div>
                <dt className="meta">{t("crm.supporter.organization")}</dt>
                <dd>
                  {contact.crm_organization ? (
                    <Link href={`/crm/${contact.crm_organization.id}`} className="underline hover:text-brand-fg">
                      {contact.crm_organization.name}
                    </Link>
                  ) : (
                    t("crm.supporter.noOrganization")
                  )}
                </dd>
              </div>
            </dl>
            {contact.zeffy_kinds.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {contact.zeffy_kinds.map((code) => (
                  <Badge key={code} tone={code === "donor" || code === "recurring" ? "brand" : "neutral"}>
                    {zeffyKindLabel(code, t)}
                  </Badge>
                ))}
              </div>
            ) : null}
            <SupporterOrganizationForm
              contactId={contact.id}
              current={contact.crm_organization?.id ?? null}
              organizations={organizations}
            />
          </section>

          {finance && totals ? (
            <section aria-labelledby="supporter-giving" className="card p-4">
              <h2 id="supporter-giving" className="section-heading mb-3">
                {t("crm.supporter.totalsHeading")}
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-[13.5px]">
                <div>
                  <dt className="meta">{t("crm.supporter.lifetime")}</dt>
                  <dd className="text-[18px] font-semibold tabular-nums">{money(totals.net_cents, totals.currency)}</dd>
                </div>
                <div>
                  <dt className="meta">{t("crm.supporter.thisYear")}</dt>
                  <dd className="text-[18px] font-semibold tabular-nums">{money(totals.this_year_cents, totals.currency)}</dd>
                </div>
                <div>
                  <dt className="meta">{t("crm.supporter.payments")}</dt>
                  <dd className="tabular-nums">{totals.payment_count}</dd>
                </div>
                <div>
                  <dt className="meta">{t("crm.supporter.lastPayment")}</dt>
                  <dd>{totals.last_paid_at ? format.date(totals.last_paid_at, session.timeZone) : "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="meta">{t("crm.supporter.firstPayment")}</dt>
                  <dd>{totals.first_paid_at ? format.date(totals.first_paid_at, session.timeZone) : "—"}</dd>
                </div>
              </dl>
              {totals.recurring_active ? (
                <p className="mt-3">
                  <Badge tone="brand">{t("crm.supporter.recurringActive")}</Badge>
                </p>
              ) : null}
              <p className="meta mt-3">{t("crm.supporter.financeOnly")}</p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
