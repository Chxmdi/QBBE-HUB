import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getPagesT } from "@/features/pages/i18n/server";
import { loadPage, loadSidebar } from "@/features/pages/services/page.queries";
import { recordPageVisit } from "@/features/pages/services/page.commands";
import { PagesShell } from "@/features/pages/components/pages-shell";
import { PageView } from "@/features/pages/components/page-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ pageId: string }> }): Promise<Metadata> {
  const { pageId } = await params;
  const t = await getPagesT();
  if (!UUID.test(pageId)) return { title: t("meta.title") };
  const supabase = await createSupabasePageClient();
  const page = await loadPage(supabase, pageId);
  return { title: page ? page.title || t("page.untitled") : t("meta.title") };
}
export const dynamic = "force-dynamic";

export default async function PageRoute({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  if (!UUID.test(pageId)) notFound();
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  const [page, sidebar] = await Promise.all([loadPage(supabase, pageId), loadSidebar(supabase, session.userId)]);
  if (!page) notFound();
  if (!page.deletedAt) await recordPageVisit(page.id);

  return (
    <PagesShell session={session} sidebar={sidebar} currentPageId={page.id}>
      <PageView session={session} page={page} sidebar={sidebar} />
    </PagesShell>
  );
}
