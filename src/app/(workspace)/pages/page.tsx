import { Suspense } from "react";
import { PageCreateDialog } from "@/features/pages/components/page-create-dialog";
import { canCreatePrivatePages, canCreateWorkspacePages } from "@/features/pages/access";
import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getPagesT } from "@/features/pages/i18n/server";
import { loadSidebar } from "@/features/pages/services/page.queries";
import { PagesShell } from "@/features/pages/components/pages-shell";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getPagesT())("meta.title") };
}
export const dynamic = "force-dynamic";

export default async function PagesHome() {
  const session = await requireSession();
  const t = await getPagesT();
  const supabase = await createSupabasePageClient();
  const sidebar = await loadSidebar(supabase, session.userId);

  return (
    <PagesShell session={session} sidebar={sidebar}>
      <PageHeader eyebrow={t("home.eyebrow")} title={t("home.title")} description={t("home.description")} actions={<Suspense fallback={null}><PageCreateDialog canCreatePrivate={canCreatePrivatePages({ userId: session.userId, role: session.role })} canCreateWorkspace={canCreateWorkspacePages({ userId: session.userId, role: session.role })} /></Suspense>} />
      {sidebar.pages.length === 0 ? (
        <EmptyState icon={<FileText />} title={t("home.emptyTitle")} description={t("home.emptyBody")} />
      ) : null}
    </PagesShell>
  );
}
