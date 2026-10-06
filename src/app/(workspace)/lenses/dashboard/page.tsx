import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/query/run";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { getLens, listLenses } from "@/features/lenses/services/lens-store.queries";
import { filtersFromParams, parseDashboardLayout } from "@/features/lenses/dashboard/schema";
import { DashboardView } from "@/features/lenses/dashboard/dashboard-view";
import { CreateDashboard } from "@/features/lenses/dashboard/create-dashboard";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("dashboard.title") };
}
export const dynamic = "force-dynamic";

/**
 * Dashboard lenses (V1-5), behind wos_lenses. Without `?lens=`: the viewer's
 * and shared dashboards, and "New dashboard". With it: the dashboard, whose
 * filters can be narrowed from the URL (`program`, `mine`, `dates`).
 */
export default async function DashboardLensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const t = await getLensT();
  const params = await searchParams;
  const lensId = Array.isArray(params.lens) ? params.lens[0] : params.lens;

  if (!lensId) {
    const dashboards = (await listLenses(session.userId)).filter((l) => l.kind === "dashboard");
    return (
      <div>
        <PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />
        <CreateDashboard />
        <section aria-labelledby="dashboards-list">
          <h2 id="dashboards-list" className="section-heading mb-2">
            {t("dashboard.yours")}
          </h2>
          {dashboards.length ? (
            <ul className="card divide-y divide-line">
              {dashboards.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <Link href={`/lenses/dashboard?lens=${d.id}`} className="flex-1 text-[14px] font-semibold text-ink hover:text-brand-fg">
                    {d.name}
                  </Link>
                  {!d.mine && d.ownerName ? <span className="meta">{t("saved.by", { name: d.ownerName })}</span> : null}
                  <Badge tone={d.visibility === "shared" ? "info" : "neutral"}>
                    {d.visibility === "shared" ? t("saved.sharedBadge") : t("saved.personal")}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card px-4 py-5 text-[13px] text-muted">{t("dashboard.none")}</p>
          )}
        </section>
      </div>
    );
  }

  const lens = await getLens(session.userId, lensId);
  if (!lens || lens.kind !== "dashboard") {
    return (
      <div>
        <PageHeader title={t("dashboard.title")} />
        <p role="alert" className="text-[13.5px] text-danger-fg">{t("dashboard.missing")}</p>
      </div>
    );
  }
  const supabase = await createSupabaseServerClient();
  const [catalog, programsRes, lenses] = await Promise.all([
    loadCatalog(supabase),
    supabase.from("program").select("id, name").is("archived_at", null).order("name"),
    listLenses(session.userId),
  ]);
  if (programsRes.error) reportError(programsRes.error, { lens: "dashboard", step: "programs" });
  const layout = parseDashboardLayout(lens.layout);
  const filters = filtersFromParams(params, layout.filters);

  return (
    <div>
      <PageHeader eyebrow={t("dashboard.title")} title={lens.name} description={t("dashboard.description")} />
      <DashboardView
        key={lens.id}
        dashboard={{ id: lens.id, name: lens.name, mine: lens.mine }}
        layout={layout}
        filters={filters}
        catalog={catalog}
        programs={((programsRes.data ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name }))}
        lenses={lenses.filter((l) => l.kind !== "dashboard" && !l.fromSavedView).map((l) => ({ id: l.id, label: l.name }))}
        timeZone={session.timeZone}
      />
    </div>
  );
}
