import { expect, it } from "vitest";
import { snapshotSections } from "../snapshot-view";

it("always emits the project headings even when a section is empty", () => {
  const titles = snapshotSections({
    project: { name: "Club", outcome: "Forty families", health: "on_track" },
    progress: { percent: 50, completed: 1, total: 2 },
    next_steps: "Book the hall",
    activity: [{ summary: "logged a risk", created_at: "2026-02-02" }],
  }).map((section) => section.title);
  expect(titles).toEqual([
    "Outcome",
    "Health",
    "Progress",
    "Milestones",
    "Blockers",
    "Decisions",
    "Next steps",
    "Recent activity",
  ]);
});

it("always emits the program headings", () => {
  const titles = snapshotSections({
    projects: [{ name: "Club", stage: "active", health: "on_track" }],
    upcoming: { milestones: [], events: [], meetings: [] },
  }).map((section) => section.title);
  expect(titles).toEqual([
    "Active projects",
    "Events",
    "Outcomes",
    "Risks",
    "People",
    "Upcoming commitments",
  ]);
});
