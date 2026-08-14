import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FolderKanban,
  FolderOpen,
  Handshake,
  Home,
  Inbox,
  KanbanSquare,
  Layers,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Presentation,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Minimum access: 'member' (everyone), 'staff', 'admin'. */
  access: "member" | "staff" | "admin";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar structure: Work, Communication, Organization (Part IV §5.2).
 * Volunteers see the simplified member-level subset (P0-VOL-02).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Home", href: "/", icon: Home, access: "member" },
      { label: "My Work", href: "/my-work", icon: ClipboardList, access: "member" },
      { label: "Board", href: "/board", icon: KanbanSquare, access: "member" },
      { label: "Projects", href: "/projects", icon: FolderKanban, access: "staff" },
      { label: "Programs", href: "/programs", icon: Layers, access: "staff" },
    ],
  },
  {
    label: "Communication",
    items: [
      { label: "Inbox", href: "/inbox", icon: Inbox, access: "member" },
      { label: "Channels", href: "/channels", icon: MessagesSquare, access: "member" },
      { label: "Messages", href: "/messages", icon: MessageSquare, access: "member" },
      {
        label: "Announcements",
        href: "/announcements",
        icon: Megaphone,
        access: "member",
      },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Calendar", href: "/calendar", icon: CalendarDays, access: "member" },
      { label: "Master Schedule", href: "/schedule", icon: CalendarRange, access: "staff" },
      { label: "Meetings", href: "/meetings", icon: Presentation, access: "member" },
      { label: "Events", href: "/events", icon: Building2, access: "member" },
      { label: "Relationships", href: "/crm", icon: Handshake, access: "staff" },
      { label: "Reports", href: "/reports", icon: BarChart3, access: "staff" },
      { label: "Documents", href: "/documents", icon: FolderOpen, access: "member" },
      { label: "People", href: "/people", icon: Users, access: "member" },
      { label: "Admin", href: "/admin", icon: Settings, access: "admin" },
    ],
  },
];

export function visibleNav(role: {
  isAdmin: boolean;
  isStaff: boolean;
}): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.access === "admin"
        ? role.isAdmin
        : item.access === "staff"
          ? role.isStaff
          : true,
    ),
  })).filter((group) => group.items.length > 0);
}
