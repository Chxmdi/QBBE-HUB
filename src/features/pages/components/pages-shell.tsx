import type { SessionContext } from "@/lib/auth";
import type { PagesSidebarData } from "@/features/pages/services/page.queries";
import { canCreatePrivatePages, canCreateWorkspacePages, canEditPage } from "@/features/pages/access";
import { PagesSidebar } from "./pages-sidebar";

/** The pages screens' two columns: the page tree, then the page itself. */
export function PagesShell({
  session,
  sidebar,
  currentPageId,
  children,
}: {
  session: SessionContext;
  sidebar: PagesSidebarData;
  currentPageId?: string;
  children: React.ReactNode;
}) {
  const viewer = { userId: session.userId, role: session.role };
  // One column below lg, never wider than the screen: an implicit grid track would grow to the widest content.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="lg:border-r lg:border-line lg:pr-3">
        <PagesSidebar
          pages={sidebar.pages}
          favouriteIds={sidebar.favouriteIds}
          recentIds={sidebar.recentIds}
          currentPageId={currentPageId}
          canCreateWorkspace={canCreateWorkspacePages(viewer)}
          canCreatePrivate={canCreatePrivatePages(viewer)}
          editableIds={sidebar.pages.filter((page) => canEditPage(viewer, page)).map((page) => page.id)}
        />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
