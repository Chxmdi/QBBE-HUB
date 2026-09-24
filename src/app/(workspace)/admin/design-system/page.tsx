import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { ComponentGallery } from "@/features/admin/components/component-gallery";
import { requireAdminAal2 } from "@/lib/auth";

export const metadata: Metadata = { title: "Design system" };
export const dynamic = "force-dynamic";

/**
 * Admin → Design system: the component gallery (UI-008). The in-app
 * equivalent of Storybook, chosen so it uses the real tokens, theme and
 * sign-in, and is covered by the same accessibility sweep as every other page.
 * See docs/design-system.md.
 */
export default async function DesignSystemPage() {
  await requireAdminAal2();
  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Design system"
        description="Every shared component in every state, in the current theme. Switch the theme in the top bar to review dark mode."
      />
      <AdminNav />
      <ComponentGallery />
    </div>
  );
}
