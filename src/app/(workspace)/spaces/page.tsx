import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { CreateSpaceForm } from "@/features/spaces/components/create-space-form";
import { SpaceList } from "@/features/spaces/components/space-list";
import { getSpacesT } from "@/features/spaces/i18n";
import { groupSpaces } from "@/features/spaces/services/spaces";
import { listMySpaces } from "@/features/spaces/services/spaces.queries";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { getPublicPagesT } from "@/features/public-pages/i18n";
import { publishedObjectIds } from "@/features/public-pages/services/publication.queries";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getSpacesT())("metaTitle") };
}

/**
 * Spaces (M10a, epic #199). Hidden behind the `wos_spaces` switch and not in
 * the main menu until integration wires it.
 */
export default async function SpacesPage() {
  const session = await requireSession();
  if (!(await isEnabled("wos_spaces"))) notFound();

  const publicPages = await isEnabled("wos_public_pages");
  const [t, locale, spaces, publicIds, pt] = await Promise.all([
    getSpacesT(),
    getLocale(),
    listMySpaces(),
    publicPages ? publishedObjectIds() : Promise.resolve(new Set<string>()),
    getPublicPagesT(),
  ]);
  const badge = { publicIds, publicLabel: pt("publicBadge") };
  const groups = groupSpaces(spaces, locale);

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          session.isAdmin ? (
            <div className="flex flex-wrap gap-4">
              <Link href="/spaces/roles" className="text-sm font-medium text-brand-fg underline underline-offset-2">
                {t("manageRoles")}
              </Link>
              {publicPages ? (
                <Link href="/spaces/publish" className="text-sm font-medium text-brand-fg underline underline-offset-2">
                  {pt("title")}
                </Link>
              ) : null}
            </div>
          ) : null
        }
      />
      {session.isAdmin ? <CreateSpaceForm /> : null}
      <SpaceList id="spaces-workspace" heading={t("sections.workspace")} spaces={groups.workspace} empty={t("nothingYet")} locale={locale} t={t} {...badge} />
      <SpaceList id="spaces-private" heading={t("sections.private")} spaces={groups.private} empty={t("nothingYet")} locale={locale} t={t} {...badge} />
      <SpaceList id="spaces-programs" heading={t("sections.programs")} spaces={groups.programs} empty={t("emptyPrograms")} locale={locale} t={t} {...badge} />
      <SpaceList id="spaces-custom" heading={t("sections.custom")} spaces={groups.custom} empty={t("emptyCustom")} locale={locale} t={t} {...badge} />
    </div>
  );
}
