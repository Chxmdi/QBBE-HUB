import { isEnabled } from "@/lib/feature-flags";
import { PageWatchButton } from "@/features/notifications/components/page-watch-button";
import { isWatchingPage } from "@/features/notifications/services/page-watch.queries";
import type { PageHeaderUnitProps } from "./types";

/**
 * Wave 2 unit C3: the watch button, shown in the page header next to the
 * page's actions. Anyone who can open the page may watch it; watchers are
 * told about new comments (20261110040000_page_watch.sql).
 */
export async function C3PageWatch({ page, session }: PageHeaderUnitProps) {
  if (!(await isEnabled("wos_pages"))) return null;
  const watching = await isWatchingPage(page.id, session.userId);
  return <PageWatchButton pageId={page.id} initialWatching={watching} />;
}
