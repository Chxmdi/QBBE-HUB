import { isEnabled } from "@/lib/feature-flags";
import { presenceColour } from "@/features/pages/services/page-presence";
import { PagePresenceHeader } from "@/features/pages/live/page-presence-header";
import type { PageHeaderUnitProps } from "./types";

/**
 * Wave 2 unit C1: who else is on the page, shown in the page header next to
 * the page's actions. Only with both wos_pages and wos_editor on; the
 * editor's live session starts from what this records, so with either
 * switch off nothing of C1 runs.
 */
export async function C1PagePresence({ page, canEdit, session }: PageHeaderUnitProps) {
  const [pages, editor] = await Promise.all([isEnabled("wos_pages"), isEnabled("wos_editor")]);
  if (!pages || !editor) return null;
  const me = { userId: session.userId, name: session.profile.full_name, colour: presenceColour(session.userId) };
  return <PagePresenceHeader key={page.id} pageId={page.id} me={me} canEdit={canEdit} />;
}
