import type { SidebarChannel } from "@/components/layout/sidebar";

export interface SidebarState {
  unreadNotifications: number;
  openTasks: number;
  /** Every channel the person is in: mandatory first, then most recently active. */
  channels: SidebarChannel[];
  unreadConversations: number;
}

/**
 * Reads what public.sidebar_state() returns. A failed call (null) or a
 * malformed value gives an empty sidebar rather than a broken page, as the
 * separate queries did when one of them failed.
 */
export function parseSidebarState(value: unknown): SidebarState {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const count = (key: string) => {
    const n = Number(raw[key] ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const channels = Array.isArray(raw.channels)
    ? (raw.channels as Record<string, unknown>[])
        .filter((c) => c && typeof c.id === "string" && typeof c.slug === "string")
        .map((c) => ({ id: c.id as string, slug: c.slug as string, unread: c.unread === true }))
    : [];
  return {
    unreadNotifications: count("unread_notifications"),
    openTasks: count("open_tasks"),
    channels,
    unreadConversations: count("unread_conversations"),
  };
}

/** Channel id to unread flag, for the channel list. */
export function unreadByChannel(state: SidebarState): Map<string, boolean> {
  return new Map(state.channels.map((c) => [c.id, c.unread]));
}
