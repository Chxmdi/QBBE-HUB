import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { SignInRuleForm } from "@/features/spaces/admin/rule-form";
import { defaultAuditRange, isOrgRole, ORG_ROLES, type OrgRoleKey } from "@/features/spaces/admin/sign-in-rules";
import { getSpacesT } from "@/features/spaces/i18n";
import { NO_ACCESS_REDIRECT, requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getSpacesT())("admin.metaTitle") };
}

interface Report {
  spaces: { id: string; kind: string; name_en: string; name_fr: string; capabilities: string[] }[];
  counts: Record<"programs" | "projects" | "tasks" | "pages", { visible: number; total: number }>;
  hidden_properties: { key: string; name_en: string; name_fr: string }[];
}

/** Admin controls (V2-9): sign-in rules, audit export, role report. Owners and admins; behind `wos_spaces`. */
export default async function AccessAdminPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const session = await requireSession();
  if (!(await isEnabled("wos_spaces"))) notFound();
  if (!session.isAdmin) redirect(NO_ACCESS_REDIRECT);

  const { role } = await searchParams;
  const reportRole: OrgRoleKey = isOrgRole(role) ? role : "staff";
  const db = await createSupabaseServerClient();
  const [t, locale, rules, report] = await Promise.all([
    getSpacesT(),
    getLocale(),
    db.from("sign_in_rule").select("role, require_mfa, max_session_hours").eq("organization_id", session.organizationId),
    db.rpc("role_visibility_report", { role: reportRole }),
  ]);
  // A failed read shows the error screen, never an empty page (#100).
  if (rules.error) throw new Error(`Could not read sign-in rules: ${rules.error.message}`);
  if (report.error) throw new Error(`Could not build the role report: ${report.error.message}`);
  const ruleByRole = new Map(
    ((rules.data ?? []) as { role: string; require_mfa: boolean; max_session_hours: number | null }[]).map((r) => [r.role, r]),
  );
  const data = (report.data ?? null) as Report | null;
  const range = defaultAuditRange();
  const capability = (c: string) => t(`capabilities.${c as "view"}`);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t("admin.title")}
        description={t("admin.description")}
        actions={
          <Link href="/spaces" className="text-sm font-medium text-brand-fg underline underline-offset-2">
            {t("roles.back")}
          </Link>
        }
      />

      <section aria-labelledby="admin-rules" className="mb-10">
        <h2 id="admin-rules" className="mb-1 text-[15px] font-semibold text-ink">
          {t("admin.rules.heading")}
        </h2>
        <p className="mb-3 text-[13px] text-muted">{t("admin.rules.help")}</p>
        <div className="grid gap-2">
          {ORG_ROLES.map((key) => (
            <SignInRuleForm
              key={key}
              role={key}
              requireMfa={ruleByRole.get(key)?.require_mfa ?? (key === "owner" || key === "admin")}
              hours={ruleByRole.get(key)?.max_session_hours ?? null}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="admin-audit" className="card mb-10 grid gap-3 p-4">
        <h2 id="admin-audit" className="text-[15px] font-semibold text-ink">
          {t("admin.audit.heading")}
        </h2>
        <p className="text-[13px] text-muted">{t("admin.audit.help")}</p>
        <form method="get" action="/spaces/admin/audit-export" className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <label htmlFor="audit-from" className="text-[13px] font-medium text-ink">
              {t("admin.audit.from")}
            </label>
            <Input id="audit-from" name="from" type="date" required defaultValue={range.from} />
          </div>
          <div className="grid gap-1">
            <label htmlFor="audit-to" className="text-[13px] font-medium text-ink">
              {t("admin.audit.to")}
            </label>
            <Input id="audit-to" name="to" type="date" required defaultValue={range.to} />
          </div>
          <Button type="submit" variant="secondary">
            {t("admin.audit.download")}
          </Button>
        </form>
      </section>

      <section aria-labelledby="admin-report" className="mb-10">
        <h2 id="admin-report" className="mb-1 text-[15px] font-semibold text-ink">
          {t("admin.report.heading")}
        </h2>
        <p className="mb-3 text-[13px] text-muted">{t("admin.report.help")}</p>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor="report-role" className="text-[13px] font-medium text-ink">
              {t("admin.report.role")}
            </label>
            <Select id="report-role" name="role" defaultValue={reportRole}>
              {ORG_ROLES.map((key) => (
                <option key={key} value={key}>
                  {t(`orgRoles.${key}`)}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            {t("admin.report.show")}
          </Button>
        </form>
        {data ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card p-4">
              <h3 className="mb-2 text-[14px] font-semibold text-ink">{t("admin.report.spaces")}</h3>
              <ul className="grid gap-1 text-[13px]">
                {data.spaces.map((space) => (
                  <li key={space.id}>
                    <span className="font-medium text-ink">{locale === "fr-CA" ? space.name_fr : space.name_en}</span>
                    <span className="text-muted">
                      {" — "}
                      {space.capabilities.length ? space.capabilities.map(capability).join(", ") : t("admin.report.nothing")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-4">
              <h3 className="mb-2 text-[14px] font-semibold text-ink">{t("admin.report.counts")}</h3>
              <ul className="grid gap-1 text-[13px] text-ink">
                <li>{t("admin.report.programs", data.counts.programs)}</li>
                <li>{t("admin.report.projects", data.counts.projects)}</li>
                <li>{t("admin.report.tasks", data.counts.tasks)}</li>
                <li>{t("admin.report.pages", data.counts.pages)}</li>
              </ul>
              <h3 className="mt-4 mb-2 text-[14px] font-semibold text-ink">{t("admin.report.hidden")}</h3>
              {data.hidden_properties.length ? (
                <ul className="grid gap-1 text-[13px] text-ink">
                  {data.hidden_properties.map((p) => (
                    <li key={p.key}>{locale === "fr-CA" ? p.name_fr : p.name_en}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">{t("admin.report.noneHidden")}</p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="admin-google" className="card p-4">
        <h2 id="admin-google" className="mb-1 text-[15px] font-semibold text-ink">
          {t("admin.google.heading")}
        </h2>
        <p className="text-[13px] text-muted">{t("admin.google.body")}</p>
        <p className="mt-1 text-[13px] text-muted">{t("admin.google.steps")}</p>
      </section>
    </div>
  );
}
