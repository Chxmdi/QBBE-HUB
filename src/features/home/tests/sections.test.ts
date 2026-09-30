import { describe, expect, it } from "vitest";
import { catalogKeys } from "@/features/universal-tasks/i18n/module-i18n";
import { homeCatalogs } from "../i18n";
import { SECTION_KEYS, WORLD_KEYS, activityHref, buildHomeSections, buildMyWorld } from "../sections";
import { ME, OTHER, activity, data, task } from "./fixtures";

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("Now", () => {
  it("lists my overdue, then due-today, then under-way work, and nothing else", () => {
    const overdue = task({ due_at: "2026-10-01" });
    const today = task({ due_at: "2026-10-07" });
    const doing = task({ status: "in_progress", due_at: "2026-10-20" });
    const later = task({ due_at: "2026-10-20" });
    const done = task({ due_at: "2026-10-01", status: "completed" });
    const theirs = task({ due_at: "2026-10-01", assignee_id: OTHER });
    const sections = buildHomeSections(data({ tasks: [later, doing, today, overdue, done, theirs] }));
    expect(ids(sections.now)).toEqual([overdue.id, today.id, doing.id]);
    expect(sections.now[0].facts[0]).toEqual({ kind: "due", date: "2026-10-01", overdue: true, today: false });
  });

  it("uses the organization's day, not UTC's", () => {
    // 01:30 UTC on the 8th is still the 7th in Toronto.
    const due = task({ due_at: "2026-10-07" });
    const sections = buildHomeSections(data({ now: new Date("2026-10-08T01:30:00Z"), tasks: [due] }));
    expect(sections.now[0].facts[0]).toMatchObject({ today: true, overdue: false });
  });

  it("shows at most five", () => {
    const many = Array.from({ length: 9 }, () => task({ due_at: "2026-10-01" }));
    expect(buildHomeSections(data({ tasks: many })).now).toHaveLength(5);
  });
});

describe("Today", () => {
  it("lists today's meetings by time, then tasks due today; not cancelled ones", () => {
    const meetings = [
      { id: "m2", title: "Afternoon", starts_at: "2026-10-07T18:00:00Z", ends_at: null, status: "scheduled", organizer_id: ME },
      { id: "m1", title: "Morning", starts_at: "2026-10-07T13:00:00Z", ends_at: null, status: "scheduled", organizer_id: ME },
      { id: "m3", title: "Cancelled", starts_at: "2026-10-07T14:00:00Z", ends_at: null, status: "cancelled", organizer_id: ME },
      { id: "m4", title: "Tomorrow", starts_at: "2026-10-08T14:00:00Z", ends_at: null, status: "scheduled", organizer_id: ME },
    ];
    const due = task({ due_at: "2026-10-07" });
    expect(ids(buildHomeSections(data({ meetings, tasks: [due] })).today)).toEqual(["m1", "m2", due.id]);
  });
});

describe("Waiting", () => {
  it("lists my blocked and waiting work, then what I asked others for", () => {
    const blocked = task({ status: "blocked", blocked_reason: "No quote yet" });
    const asked = task({ assignee_id: OTHER, due_at: "2026-10-09", assignee: { full_name: "Grace" } });
    const unassigned = task({ assignee_id: null });
    const askedDone = task({ assignee_id: OTHER, status: "completed" });
    const sections = buildHomeSections(data({ tasks: [asked, blocked, unassigned, askedDone] }));
    expect(ids(sections.waiting)).toEqual([asked.id, blocked.id]);
    expect(sections.waiting[0].facts).toContainEqual({ kind: "person", name: "Grace" });
    expect(sections.waiting[1].facts).toContainEqual({ kind: "reason", text: "No quote yet" });
  });
});

describe("Continue", () => {
  it("lists the last records I touched, once each, skipping what is already in Now", () => {
    const inNow = task({ due_at: "2026-10-01" });
    const open = task();
    const events = [
      activity({ source_id: open.id, created_at: "2026-10-07T10:00:00Z" }),
      activity({ source_id: open.id, created_at: "2026-10-07T11:00:00Z" }),
      activity({ source_id: inNow.id }),
      activity({ source_type: "project", source_id: "p1", summary: "updated the plan", created_at: "2026-10-07T09:00:00Z" }),
      activity({ source_id: "gone" }),
      activity({ source_type: "document", source_id: "d1", created_at: "2026-09-01T00:00:00Z" }),
      activity({ source_type: "project", source_id: "p2", actor_id: OTHER }),
    ];
    const sections = buildHomeSections(data({ tasks: [inNow, open], activity: events }));
    expect(sections.continue.map((item) => item.href)).toEqual([`/my-work?task=${open.id}`, "/projects/p1"]);
  });
});

describe("Decisions", () => {
  it("puts approvals and reviews waiting on me before recent decisions", () => {
    const review = task({ status: "in_review", reviewer_id: ME, assignee_id: OTHER });
    const ownReview = task({ status: "in_review", reviewer_id: ME });
    const sections = buildHomeSections(
      data({
        tasks: [review, ownReview],
        approvals: [
          { id: "ap1", note: "Budget\nmore", due_at: "2026-10-05", created_at: "2026-10-01T00:00:00Z", requested_by: OTHER, project_request_id: null, report_id: null, opportunity_id: null },
        ],
        decisions: [
          { id: "d1", title: "Venue chosen", decided_at: "2026-10-06T00:00:00Z", project_id: "p1", meeting_id: null },
          { id: "d0", title: "Old", decided_at: "2026-08-01T00:00:00Z", project_id: "p1", meeting_id: null },
        ],
      }),
    );
    expect(ids(sections.decisions)).toEqual(["ap1", review.id, "d1"]);
    expect(sections.decisions[0]).toMatchObject({ title: "Budget", href: "/approvals" });
    expect(sections.decisions[1].facts).toContainEqual({ kind: "role", role: "reviewer" });
  });
});

describe("Changes", () => {
  it("lists what others did in the last three days, newest first", () => {
    const events = [
      activity({ actor_id: OTHER, created_at: "2026-10-06T00:00:00Z", source_type: "project", source_id: "p1" }),
      activity({ actor_id: OTHER, created_at: "2026-10-07T00:00:00Z" }),
      activity({ actor_id: OTHER, created_at: "2026-10-01T00:00:00Z" }),
      activity({ actor_id: ME, created_at: "2026-10-07T00:00:00Z" }),
    ];
    const sections = buildHomeSections(data({ activity: events }));
    expect(ids(sections.changes)).toEqual([events[1].id, events[0].id]);
  });

  it("links each change to its record", () => {
    expect(activityHref({ source_type: "task", source_id: "x", project_id: null })).toBe("/my-work?task=x");
    expect(activityHref({ source_type: "decision", source_id: "x", project_id: "p" })).toBe("/projects/p");
    expect(activityHref({ source_type: "decision", source_id: "x", project_id: null })).toBe("/");
  });
});

describe("My World", () => {
  it("gathers my tasks, meetings, projects, what others owe me, mentions and decisions", () => {
    const mine = task({ due_at: "2026-10-09", project_id: "p2" });
    const undated = task();
    const owed = task({ assignee_id: OTHER });
    const world = buildMyWorld(
      data({
        tasks: [undated, mine, owed],
        meetings: [
          { id: "m1", title: "Soon", starts_at: "2026-10-10T14:00:00Z", ends_at: null, status: "scheduled", organizer_id: OTHER },
          { id: "m2", title: "Far", starts_at: "2026-11-30T14:00:00Z", ends_at: null, status: "scheduled", organizer_id: OTHER },
        ],
        projects: [
          { id: "p1", name: "Owned", stage: "active", health: "at_risk", priority: "high", target_date: "2026-12-01", owner_id: ME, sponsor_id: null, updated_at: "" },
          { id: "p2", name: "Worked on", stage: "active", health: "on_track", priority: "low", target_date: null, owner_id: OTHER, sponsor_id: null, updated_at: "" },
          { id: "p3", name: "Unrelated", stage: "active", health: "on_track", priority: "low", target_date: null, owner_id: OTHER, sponsor_id: null, updated_at: "" },
        ],
        mentions: [
          { id: "n1", title: "Ada mentioned you", body: "Can you check?\nthanks", link: "/channels/c?message=m", created_at: "2026-10-06T00:00:00Z", read_at: null },
        ],
      }),
    );
    expect(ids(world.tasks)).toEqual([mine.id, undated.id]);
    expect(ids(world.meetings)).toEqual(["m1"]);
    expect(ids(world.projects)).toEqual(["p1", "p2"]);
    expect(world.projects[0].facts).toContainEqual({ kind: "role", role: "owner" });
    expect(ids(world.waitingOn)).toEqual([owed.id]);
    expect(world.mentions[0]).toMatchObject({ href: "/channels/c?message=m" });
    expect(world.mentions[0].facts[0]).toEqual({ kind: "summary", text: "Can you check?" });
    expect(Object.keys(world)).toEqual([...WORLD_KEYS]);
  });
});

describe("determinism and strings", () => {
  it("gives the same page for the same data", () => {
    const tasks = [task({ due_at: "2026-10-01" }), task({ status: "in_progress" }), task({ due_at: "2026-10-07" })];
    expect(buildHomeSections(data({ tasks }))).toEqual(buildHomeSections(data({ tasks: [...tasks].reverse() })));
    expect(Object.keys(buildHomeSections(data()))).toEqual([...SECTION_KEYS]);
  });

  it("has every English key in French", () => {
    expect(catalogKeys(homeCatalogs["fr-CA"])).toEqual(catalogKeys(homeCatalogs.en));
  });
});
