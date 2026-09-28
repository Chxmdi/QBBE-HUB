import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { ComponentGallery } from "@/features/admin/components/component-gallery";
import { requireAdminAal2 } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.designSystem.title") };
}
export const dynamic = "force-dynamic";

/**
 * Admin → Design system: the component gallery (UI-008). The in-app
 * equivalent of Storybook, chosen so it uses the real tokens, theme and
 * sign-in, and is covered by the same accessibility sweep as every other page.
 * See docs/design-system.md.
 */
export default async function DesignSystemPage() {
  await requireAdminAal2();
  const t = await getT();
  return (
    <div>
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.designSystem.title")}
        description={t("admin.designSystem.description")}
      />
      <AdminNav />
      <ComponentGallery />
    </div>
  );
}
