import { describe, expect, it } from "vitest";
import {
  collapseDrafts,
  mergeReasons,
  notificationDedupeKey,
  type NotificationDraft,
} from "@/features/jobs/services/notify";

const draft = (overrides: Partial<NotificationDraft> = {}): NotificationDraft => ({
  user_id: "user-1",
  organization_id: "org-1",
  category: "assignment",
  title: "Task assigned",
  dedupe_key: "task:t1:user-1",
  reason: "assigned",
  ...overrides,
});

describe("notificationDedupeKey", () => {
  it("names the event, not the reason", () => {
    expect(notificationDedupeKey("task", "t1", "u1")).toBe("task:t1:u1");
    expect(notificationDedupeKey("task", "t1", "u1", "2026-08-20")).toBe(
      "task:t1:2026-08-20:u1",
    );
  });
});

describe("mergeReasons", () => {
  it("keeps first-seen order and drops duplicates", () => {
    expect(mergeReasons("assigned, followed", "mentioned, assigned")).toBe(
      "assigned, followed, mentioned",
    );
  });
});

describe("collapseDrafts", () => {
  it("merges overlapping reasons on the same event into one draft", () => {
    const collapsed = collapseDrafts([
      draft({ reason: "assigned" }),
      draft({ reason: "followed", title: "You follow this", urgency: "high" }),
      draft({ reason: "mentioned" }),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].reason).toBe("assigned, followed, mentioned");
    expect(collapsed[0].urgency).toBe("high");
  });

  it("keeps a later event on a different key", () => {
    const collapsed = collapseDrafts([
      draft({ reason: "assigned" }),
      draft({
        category: "due_date",
        title: "Due date moved",
        dedupe_key: "task_due:t1:2026-08-21:user-1",
        reason: "due date",
      }),
    ]);
    expect(collapsed).toHaveLength(2);
  });

  it("drops a draft with no key", () => {
    expect(
      collapseDrafts([
        { ...draft(), dedupe_key: "" },
      ]),
    ).toHaveLength(0);
  });
});
