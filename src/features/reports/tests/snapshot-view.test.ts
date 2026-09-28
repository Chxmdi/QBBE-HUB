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

it("writes the headings, codes and dates in French when asked", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  const { formattersFor } = await import("@/lib/i18n/format");
  const { formatStoredDate } = await import("../snapshot-view");
  const format = formattersFor("fr-CA");
  const sections = snapshotSections(
    {
      project: { name: "Club", outcome: "x", health: "on_track" },
      progress: { percent: 50, completed: 1, total: 2 },
      milestones: [{ name: "Kickoff", due_date: "2026-09-28", completed_at: null }],
    },
    { t: createTranslator("fr-CA"), date: (value) => formatStoredDate(format, value) },
  );
  expect(sections[0].title).toBe("Résultat visé");
  expect(sections[1].rows[0].primary).toBe("sur la bonne voie");
  expect(sections[2].rows[0].primary).toBe("50 %");
  expect(sections[3].rows[0].secondary).toBe("Ouvert · échéance le 28 sept. 2026");
});
