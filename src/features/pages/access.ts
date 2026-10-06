import type { OrgRole } from "@/types/entities";
import type { PageRow } from "./tree";

/**
 * What the screens offer each person. A hint for which buttons to show only:
 * the page table's RLS (app.can_write_page_row) is the rule, and refuses
 * anything this lets through by mistake.
 */

const CAN_WRITE_WORKSPACE: readonly string[] = ["owner", "admin", "staff"];
const CAN_WRITE_PRIVATE: readonly string[] = ["owner", "admin", "staff", "volunteer"];
const CAN_READ_WORKSPACE: readonly string[] = ["owner", "admin", "leadership_viewer", "staff"];

export interface PageViewer {
  userId: string;
  role: OrgRole | string;
}

export function canCreateWorkspacePages(viewer: PageViewer): boolean {
  return CAN_WRITE_WORKSPACE.includes(viewer.role);
}

export function canCreatePrivatePages(viewer: PageViewer): boolean {
  return CAN_WRITE_PRIVATE.includes(viewer.role);
}

export function canReadWorkspacePages(viewer: PageViewer): boolean {
  return CAN_READ_WORKSPACE.includes(viewer.role);
}

export function canEditPage(viewer: PageViewer, page: Pick<PageRow, "visibility" | "createdBy" | "deletedAt">): boolean {
  if (page.deletedAt) return false;
  if (page.visibility === "workspace") return canCreateWorkspacePages(viewer);
  return page.createdBy === viewer.userId && canCreatePrivatePages(viewer);
}
