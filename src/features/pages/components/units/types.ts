import type { SessionContext } from "@/lib/auth";
import type { PageRow } from "@/features/pages/tree";

/** What a wave 2 unit's page-header slot receives (rendered next to the page's actions). */
export interface PageHeaderUnitProps {
  page: PageRow;
  canEdit: boolean;
  session: SessionContext;
}
