import { describe, expect, it } from "vitest";
import { navBadge } from "@/config/navigation";
import { parseSidebarState, unreadByChannel } from "@/features/channels/sidebar-state";

describe("parseSidebarState", () => {
  it("reads what sidebar_state() returns, keeping every channel in order", () => {
    const channels = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i + 1}`,
      slug: `channel-${i + 1}`,
      unread: i === 11,
    }));
    const state = parseSidebarState({
      unread_notifications: 3,
      open_tasks: 6,
      channels,
      unread_conversations: 2,
    });
    expect(state).toEqual({
      unreadNotifications: 3,
      openTasks: 6,
      channels,
      unreadConversations: 2,
    });
    expect(unreadByChannel(state).get("c12")).toBe(true);
  });

  it("gives an empty sidebar for a failed call or a malformed value", () => {
    const empty = { unreadNotifications: 0, openTasks: 0, channels: [], unreadConversations: 0 };
    expect(parseSidebarState(null)).toEqual(empty);
    expect(parseSidebarState({ channels: [{ id: 1 }, null], open_tasks: "x" })).toEqual(empty);
  });
});

describe("navBadge", () => {
  it("shows unread conversations on Messages", () => {
    const counts = { myWork: 4, inbox: 2, messages: 1 };
    expect(navBadge({ badge: "messages" }, counts)).toBe(1);
    expect(navBadge({ badge: "inbox" }, counts)).toBe(2);
    expect(navBadge({ badge: "myWork" }, counts)).toBe(4);
    expect(navBadge({}, counts)).toBe(0);
    expect(navBadge({ badge: "messages" }, { myWork: 0, inbox: 0 })).toBe(0);
  });
});
