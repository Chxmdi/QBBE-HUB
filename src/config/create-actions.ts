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

export function createActions(role: { isAdmin: boolean; isStaff: boolean }): CreateAction[] {
  return [
    { label: "Task", href: "/my-work?create=task" },
    // Member-level, like /requests itself: the one thing a volunteer or
    // member can start that becomes someone else's decision.
    { label: "Project proposal", href: "/requests?create=1" },
    ...(role.isStaff
      ? [
          { label: "Project", href: "/projects?create=1" },
          { label: "Program", href: "/programs?create=1" },
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
