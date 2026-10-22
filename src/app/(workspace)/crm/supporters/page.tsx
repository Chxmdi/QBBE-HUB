import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HeartHandshake } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/table";
import { CrmTabs } from "@/features/crm/components/crm-tabs";
import { contactSourceLabel, zeffyKindLabel } from "@/features/crm/labels";
import {
  getSupporterTotals,
  listSupporters,
  SUPPORTERS_PAGE_SIZE,
} from "@/features/crm/services/supporter.queries";
import { ZEFFY_KINDS } from "@/features/zeffy/types";
import { requireSession, NO_ACCESS_REDIRECT } from "@/lib/auth";
import { getFormatters, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.supporters.title") };
}
export const dynamic = "force-dynamic";

function pageHref(params: { q?: string; kind?: string; source?: string }, page: number): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.kind) search.set("kind", params.kind);
  if (params.source) search.set("source", params.source);
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `/crm/supporters?${query}` : "/crm/supporters";
}

export default async function SupportersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; source?: string; page?: string }>;
}) {
  const session = await requireSession();
  if (!session.isStaff) redirect(NO_ACCESS_REDIRECT);
  const params = await searchParams;
  const kind = (ZEFFY_KINDS as readonly string[]).includes(params.kind ?? "") ? params.kind : undefined;
  const source = params.source === "hub" || params.source === "zeffy" ? params.source : undefined;
  const q = params.q?.slice(0, 100) || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [t, format, list, totals] = await Promise.all([
    getT(),
    getFormatters(),
    listSupporters({ q, kind, source, page }),
    getSupporterTotals(session.organizationId),
  ]);
  const money = (cents: number, currency: string | null) =>
    format.currency(cents / 100, (currency ?? "cad").toUpperCase());
  const first = (list.page - 1) * SUPPORTERS_PAGE_SIZE + 1;

  return (
    <div>
      <PageHeader
        eyebrow={t("crm.eyebrow")}
        title={t("crm.supporters.title")}
        description={t("crm.supporters.description")}
        actions={
          totals ? (
            <a
              href="/api/crm/supporters/export"
              className="inline-flex h-9 items-center rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-soft"
            >
              {t("crm.supporters.export")}
            </a>
          ) : null
        }
      />
      <CrmTabs active="supporters" />

      <form method="get" action="/crm/supporters" className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="supporter-search">{t("crm.supporters.searchLabel")}</Label>
          <Input
            id="supporter-search"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder={t("crm.supporters.searchPlaceholder")}
          />
        </div>
        <div>
          <Label htmlFor="supporter-kind">{t("crm.supporters.kind")}</Label>
          <Select id="supporter-kind" name="kind" defaultValue={kind ?? ""}>
            <option value="">{t("crm.supporters.anyKind")}</option>
            {ZEFFY_KINDS.map((code) => (
              <option key={code} value={code}>
                {zeffyKindLabel(code, t)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="supporter-source">{t("crm.supporters.source")}</Label>
          <Select id="supporter-source" name="source" defaultValue={source ?? ""}>
            <option value="">{t("crm.supporters.anySource")}</option>
            <option value="zeffy">{contactSourceLabel("zeffy", t)}</option>
            <option value="hub">{contactSourceLabel("hub", t)}</option>
          </Select>
        </div>
        <button
          type="submit"
          className="inline-flex h-9.5 items-center rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-strong"
        >
          {t("crm.supporters.apply")}
        </button>
        {q || kind || source ? (
          <Link href="/crm/supporters" className="text-[13px] text-muted underline hover:text-ink">
            {t("crm.supporters.clear")}
          </Link>
        ) : null}
      </form>

      {totals ? <p className="meta mb-3">{t("crm.supporters.financeNote")}</p> : null}

      {list.rows.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake />}
          title={t("crm.supporters.emptyTitle")}
          description={t("crm.supporters.emptyDescription")}
        />
      ) : (
        <section aria-labelledby="supporters-heading">
          <h2 id="supporters-heading" className="sr-only">
            {t("crm.supporters.title")}
          </h2>
          <DataTable minWidth={totals ? "820px" : "640px"}>
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporters.name")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporters.kind")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporters.organization")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("crm.supporters.lastActivity")}</th>
                {totals ? (
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("crm.supporters.given")}</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.rows.map((row) => {
                const giving = totals?.get(row.id);
                return (
                  <tr key={row.id} className="interactive-row">
                    <td className="px-3 py-2.5">
                      <Link href={`/crm/contacts/${row.id}`} className="font-medium hover:text-brand-fg">
                        {row.full_name}
                      </Link>
                      {row.email ? <p className="meta truncate">{row.email}</p> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {row.zeffy_kinds.length ? (
                          row.zeffy_kinds.map((code) => (
                            <Badge key={code} tone={code === "donor" || code === "recurring" ? "brand" : "neutral"}>
                              {zeffyKindLabel(code, t)}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted">{t("crm.supporters.none")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.crm_organization ? (
                        <Link href={`/crm/${row.crm_organization.id}`} className="hover:text-brand-fg">
                          {row.crm_organization.name}
                        </Link>
                      ) : (
                        <span className="text-muted">{t("crm.supporters.none")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.zeffy_last_activity_at ? format.date(row.zeffy_last_activity_at, session.timeZone) : t("crm.supporters.none")}
                    </td>
                    {totals ? (
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {giving ? money(giving.net_cents, giving.currency) : t("crm.supporters.none")}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          <nav aria-label={t("crm.supporters.title")} className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
            <span className="text-muted">
              {t("crm.supporters.showing", { from: first, to: first + list.rows.length - 1 })}
            </span>
            {list.page > 1 ? (
              <Link href={pageHref({ q, kind, source }, list.page - 1)} className="underline hover:text-brand-fg">
                {t("crm.supporters.previous")}
              </Link>
            ) : null}
            {list.hasMore ? (
              <Link href={pageHref({ q, kind, source }, list.page + 1)} className="underline hover:text-brand-fg">
                {t("crm.supporters.next")}
              </Link>
            ) : null}
          </nav>
        </section>
      )}
    </div>
  );
}
