import { describe, expect, it } from "vitest";
import { homeT } from "../i18n";
import { daysUntil, rankByAttention, scoreAttention, type AttentionInput } from "../attention";
import { explainAttention, reasonText } from "../explain";
import { attentionCandidates, buildHomeSections, NOW_THRESHOLD } from "../sections";
import { ME, OTHER, activity, data, task } from "./fixtures";

const TODAY = "2026-10-07";
const en = homeT("en");
const fr = homeT("fr-CA");

function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    kind: "task",
    id: "t",
    title: "Task",
    due: null,
    taskPriority: null,
    project: null,
    role: null,
    blocks: 0,
    unreadMentions: 0,
    recentChanges: 0,
    ...overrides,
  };
}

describe("deadline closeness", () => {
  it.each([
    ["2026-10-06", 42, "overdue"],
    ["2026-09-01", 60, "overdue"],
    ["2026-10-07", 35, "due_today"],
    ["2026-10-08", 28, "due_soon"],
    ["2026-10-10", 20, "due_soon"],
    ["2026-10-14", 10, "due_soon"],
    ["2026-10-15", 0, null],
  ])("due %s scores %i", (due, points, rule) => {
    const score = scoreAttention(input({ due }), TODAY);
    expect(score.score).toBe(points);
    expect(score.reasons[0]?.rule ?? null).toBe(rule);
  });

  it("counts whole calendar days", () => {
    expect(daysUntil(TODAY, "2026-10-07")).toBe(0);
    expect(daysUntil(TODAY, "2026-10-10")).toBe(3);
    expect(daysUntil(TODAY, "2026-09-30")).toBe(-7);
    // Across the autumn clock change.
    expect(daysUntil("2026-10-31", "2026-11-02")).toBe(2);
  });
});

describe("the other rules", () => {
  it("scores the project's deadline and priority", () => {
    const soon = scoreAttention(input({ project: { name: "Website launch", target: "2026-10-10", priority: "high" } }), TODAY);
    expect(soon.reasons).toEqual([
      { rule: "project_deadline", points: 15, project: "Website launch", days: 3 },
      { rule: "project_priority", points: 8, priority: "high" },
    ]);
    expect(scoreAttention(input({ project: { name: "P", target: "2026-10-01", priority: null } }), TODAY).score).toBe(15);
    expect(scoreAttention(input({ project: { name: "P", target: "2026-10-13", priority: null } }), TODAY).score).toBe(8);
    expect(scoreAttention(input({ project: { name: "P", target: "2026-10-21", priority: null } }), TODAY).score).toBe(4);
    expect(scoreAttention(input({ project: { name: "P", target: "2026-10-22", priority: "low" } }), TODAY).score).toBe(0);
  });

  it("scores what the item blocks, capped", () => {
    expect(scoreAttention(input({ blocks: 2 }), TODAY).score).toBe(16);
    expect(scoreAttention(input({ blocks: 9 }), TODAY).score).toBe(24);
    expect(scoreAttention(input({ kind: "project", blocks: 2 }), TODAY).reasons).toEqual([
      { rule: "my_tasks_in_project", points: 12, count: 2 },
    ]);
    expect(scoreAttention(input({ kind: "project", blocks: 5 }), TODAY).score).toBe(18);
  });

  it("scores mentions, role, priority and recent changes", () => {
    expect(scoreAttention(input({ unreadMentions: 1 }), TODAY).score).toBe(6);
    expect(scoreAttention(input({ unreadMentions: 4 }), TODAY).score).toBe(12);
    expect(scoreAttention(input({ role: "assignee" }), TODAY).score).toBe(10);
    expect(scoreAttention(input({ role: "approver" }), TODAY).score).toBe(8);
    expect(scoreAttention(input({ role: "reviewer" }), TODAY).score).toBe(6);
    expect(scoreAttention(input({ role: "requester" }), TODAY).score).toBe(2);
    expect(scoreAttention(input({ taskPriority: "critical" }), TODAY).score).toBe(10);
    expect(scoreAttention(input({ taskPriority: "low" }), TODAY).reasons).toEqual([]);
    expect(scoreAttention(input({ recentChanges: 1 }), TODAY).score).toBe(5);
    expect(scoreAttention(input({ recentChanges: 3 }), TODAY).score).toBe(8);
  });

  it("adds the rules up and lists reasons strongest first", () => {
    const score = scoreAttention(
      input({ due: "2026-10-08", role: "assignee", blocks: 1, taskPriority: "high", unreadMentions: 1 }),
      TODAY,
    );
    expect(score.score).toBe(28 + 10 + 8 + 6 + 6);
    expect(score.reasons.map((reason) => reason.rule)).toEqual(["due_soon", "role", "blocks", "task_priority", "mentions"]);
  });
});

describe("ranking", () => {
  it("orders by score, then due date, then title, then id", () => {
    const ranked = rankByAttention(
      [
        { item: "b", input: input({ id: "b", title: "B", due: "2026-10-14" }) },
        { item: "a", input: input({ id: "a", title: "A", due: "2026-10-14" }) },
        { item: "late", input: input({ id: "late", title: "Z", due: "2026-10-01" }) },
        { item: "none", input: input({ id: "none", title: "N" }) },
      ],
      TODAY,
    );
    expect(ranked.map((entry) => entry.item)).toEqual(["late", "a", "b", "none"]);
  });
});

describe("explanations", () => {
  it("say the strongest reasons in plain language", () => {
    const project = scoreAttention(
      input({ kind: "project", title: "Website launch", due: "2026-10-10", blocks: 2 }),
      TODAY,
    );
    expect(explainAttention(project, en)).toBe("Website launch in 3 days; 2 of your tasks block it");
    expect(explainAttention(project, fr)).toBe("Website launch dans 3 jours ; 2 de vos tâches le bloquent");
  });

  it("have words for every reason, in both languages", () => {
    const reasons = scoreAttention(
      input({
        due: "2026-10-06",
        project: { name: "Gala", target: "2026-10-07", priority: "critical" },
        blocks: 1,
        taskPriority: "medium",
        unreadMentions: 2,
        role: "reviewer",
        recentChanges: 1,
      }),
      TODAY,
    ).reasons;
    expect(reasons.map((reason) => reasonText(reason, en))).toEqual([
      "Overdue by 1 day",
      "Gala is due today",
      "Critical project",
      "You were mentioned 2 times",
      "Blocks 1 other task",
      "Waiting for your review",
      "Someone else changed it in the last two days",
      "Medium priority",
    ]);
    for (const reason of reasons) {
      const text = reasonText(reason, fr);
      expect(text).not.toMatch(/attention\./);
      expect(text).not.toBe(reasonText(reason, en));
    }
  });
});

describe("attention on Home", () => {
  it("counts blocked tasks, mentions and others' changes from the loaded rows", () => {
    const mine = task({ due_at: "2026-10-08", project_id: "p1" });
    const candidates = attentionCandidates(
      data({
        tasks: [mine],
        projects: [
          { id: "p1", name: "Website launch", stage: "active", health: "on_track", priority: "high", target_date: "2026-10-10", owner_id: ME, sponsor_id: null, updated_at: "" },
        ],
        dependencies: [
          { blocking_task_id: mine.id, blocked_task_id: "x1" },
          { blocking_task_id: mine.id, blocked_task_id: "x2" },
          { blocking_task_id: "other", blocked_task_id: "x3" },
        ],
        mentions: [
          { id: "n1", title: "", body: null, link: null, created_at: "2026-10-07T00:00:00Z", read_at: null, source_id: mine.id },
          { id: "n2", title: "", body: null, link: null, created_at: "2026-10-07T00:00:00Z", read_at: "2026-10-07T01:00:00Z", source_id: mine.id },
        ],
        activity: [
          activity({ actor_id: OTHER, source_id: mine.id, created_at: "2026-10-07T10:00:00Z" }),
          activity({ actor_id: OTHER, source_id: mine.id, created_at: "2026-10-01T10:00:00Z" }),
          activity({ actor_id: ME, source_id: mine.id }),
        ],
      }),
    );
    expect(candidates.map((candidate) => candidate.input)).toMatchObject([
      { kind: "task", blocks: 2, unreadMentions: 1, recentChanges: 1, role: "assignee" },
      { kind: "project", blocks: 1, role: "owner", due: "2026-10-10" },
    ]);
  });

  it("puts a project with a close deadline in Now with the example explanation", () => {
    const tasks = [task({ project_id: "p1" }), task({ project_id: "p1" })];
    const sections = buildHomeSections(
      data({
        tasks,
        projects: [
          { id: "p1", name: "Website launch", stage: "active", health: "at_risk", priority: "medium", target_date: "2026-10-10", owner_id: OTHER, sponsor_id: null, updated_at: "" },
        ],
      }),
    );
    const project = sections.now.find((item) => item.kind === "project");
    expect(project?.attention?.score).toBeGreaterThanOrEqual(NOW_THRESHOLD);
    expect(explainAttention(project!.attention!, en)).toBe("Website launch in 3 days; 2 of your tasks block it");
  });
});
