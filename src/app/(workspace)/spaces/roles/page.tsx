import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DeleteRoleButton, RoleForm } from "@/features/spaces/components/role-form";
import { getSpacesT } from "@/features/spaces/i18n";
import { listSharingRoles } from "@/features/spaces/services/roles.queries";
import type { AccessRole } from "@/features/spaces/services/roles";
import { NO_ACCESS_REDIRECT, requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getSpacesT())("roles.metaTitle") };
}

/** Custom roles (M10d), for owners and admins. Behind `wos_spaces`. */
export default async function RolesPage() {
  const session = await requireSession();
  if (!(await isEnabled("wos_spaces"))) notFound();
  if (!session.isAdmin) redirect(NO_ACCESS_REDIRECT);

  const [t, locale, roles] = await Promise.all([getSpacesT(), getLocale(), listSharingRoles(true)]);
  const name = (role: AccessRole) => (locale === "fr-CA" ? role.name.fr : role.name.en);
  const capabilities = (role: AccessRole) => role.capabilities.map((c) => t(`capabilities.${c}`)).join(", ");
  const builtin = roles.filter((role) => role.builtin);
  const custom = roles.filter((role) => !role.builtin);

  return (
    <div>
      <PageHeader
        title={t("roles.title")}
        description={t("roles.description")}
        actions={
          <Link href="/spaces" className="text-sm font-medium text-brand-fg underline underline-offset-2">
            {t("roles.back")}
          </Link>
        }
      />

      <section aria-labelledby="roles-create" className="card mb-8 max-w-2xl p-4">
        <h2 id="roles-create" className="mb-3 text-[15px] font-semibold text-ink">
          {t("roles.createHeading")}
        </h2>
        <RoleForm />
      </section>

      <section aria-labelledby="roles-custom" className="mb-8">
        <h2 id="roles-custom" className="mb-3 text-[15px] font-semibold text-ink">
          {t("roles.customHeading")}
        </h2>
        {custom.length === 0 ? (
          <p className="text-sm text-muted">{t("roles.emptyCustom")}</p>
        ) : (
          <ul className="grid gap-3">
            {custom.map((role) => (
              <li key={role.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14.5px] font-semibold text-ink">{name(role)}</h3>
                  <Badge>
                    {role.uses === 1
                      ? t("roles.usedByOne")
                      : role.uses
                        ? t("roles.usedBy", { count: role.uses })
                        : t("roles.notUsed")}
                  </Badge>
                </div>
                <p className="mt-1 text-[13px] text-muted">{capabilities(role)}</p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-brand-fg">
                    {t("roles.edit", { name: name(role) })}
                  </summary>
                  <div className="mt-3 grid gap-4">
                    <RoleForm role={role} />
                    <DeleteRoleButton role={role} label={t("roles.delete", { name: name(role) })} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="roles-builtin" className="mb-8">
        <h2 id="roles-builtin" className="mb-3 text-[15px] font-semibold text-ink">
          {t("roles.builtinHeading")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {builtin.map((role) => (
            <li key={role.id} className="card p-3">
              <h3 className="text-[14px] font-semibold text-ink">{name(role)}</h3>
              <p className="mt-0.5 text-[13px] text-muted">{capabilities(role)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
