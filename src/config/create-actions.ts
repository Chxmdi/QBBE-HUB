import { navHref, type NavSwitches } from "@/config/navigation";

/**
 * What a person can create from anywhere (P0-QC-01, P0-CMD-01). One list,
 * read by the topbar's quick create and by the command palette, so the two
 * never disagree about what is on offer. Access mirrors the pages each link
 * opens; the page and the database still decide.
 */
export interface CreateAction {
  label: string;
  href: string;
}

export function createActions(role: { isAdmin: boolean; isStaff: boolean }, switches?: NavSwitches): CreateAction[] {
  return [
    { label: "Task", href: `${navHref("/my-work", switches)}?create=task` },
    ...(switches?.wos_pages && (role.isStaff || role.isAdmin) ? [{ label: "Page", href: "/pages?create=1" }] : []),
    // Member-level, like /requests itself: the one thing a volunteer or
    // member can start that becomes someone else's decision.
    { label: "Project proposal", href: "/requests?create=1" },
    ...(role.isStaff
      ? [
          // Whether a staff member manages a program (and so may create a
          // project) is answered on /projects, which explains it when not.
          { label: "Project", href: "/projects?create=1" },
          ...(role.isAdmin ? [{ label: "Program", href: "/programs?create=1" }] : []),
          { label: "Meeting", href: "/meetings?create=1" },
          { label: "Event", href: "/events?create=1" },
          { label: "Channel", href: "/channels?create=1" },
          { label: "CRM organization", href: "/crm?create=organization" },
          { label: "CRM contact", href: "/crm?create=contact" },
          { label: "CRM follow-up", href: "/crm?create=follow-up" },
        ]
      : []),
    ...(role.isAdmin ? [{ label: "Announcement", href: "/channels?create=announcement" }] : []),
  ];
}

/** Keep the common actions short without removing specialist creation paths. */
export function splitCreateActions(actions: CreateAction[]): { common: CreateAction[]; more: CreateAction[] } {
  const commonNames = new Set(["Task", "Page", "Meeting", "Project", "Project proposal"]);
  return {
    common: actions.filter((action) => commonNames.has(action.label)),
    more: actions.filter((action) => !commonNames.has(action.label)),
  };
}
