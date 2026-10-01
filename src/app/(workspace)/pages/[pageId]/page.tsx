import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getPagesT } from "@/features/pages/i18n/server";
import { loadPage, loadSidebar } from "@/features/pages/services/page.queries";
import { recordPageVisit } from "@/features/pages/services/page.commands";
import { PagesShell } from "@/features/pages/components/pages-shell";
import { PageView } from "@/features/pages/components/page-view";
import { canEditPage } from "@/features/pages/access";
import { isEnabled } from "@/lib/feature-flags";
import { loadEditorDocument } from "@/features/editor/services/editor-document.queries";
import { ObjectEditor } from "@/features/editor/components/object-editor";
import { PageCollab } from "@/features/pages/components/page-collab";
import { blockIdSchema } from "@/features/object-comments/schema";

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

export default async function PageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ block?: string }>;
}) {
  const { pageId } = await params;
  if (!UUID.test(pageId)) notFound();
  const block = blockIdSchema.safeParse((await searchParams).block);
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  const [page, sidebar, editorOn] = await Promise.all([
    loadPage(supabase, pageId),
    loadSidebar(supabase, session.userId),
    isEnabled("wos_editor"),
  ]);
  if (!page) notFound();
  if (!page.deletedAt) await recordPageVisit(page.id);
  const body = editorOn ? await loadEditorDocument(supabase, page.id) : null;
  const canEdit = canEditPage({ userId: session.userId, role: session.role }, page);

  return (
    <PagesShell session={session} sidebar={sidebar} currentPageId={page.id}>
      <PageView session={session} page={page} sidebar={sidebar}>
        {body ? (
          <ObjectEditor
            key={page.id}
            objectId={page.id}
            objectType="page"
            initialContent={body.content}
            initialState={body.state}
            initialVersion={body.version}
            timeZone={session.timeZone}
            editable={canEdit}
          />
        ) : null}
        {page.deletedAt ? null : (
          <PageCollab
            pageId={page.id}
            canEdit={canEdit}
            blockId={block.success ? block.data : null}
            editorMounted={Boolean(body) && canEdit}
          />
        )}
      </PageView>
    </PagesShell>
  );
}
