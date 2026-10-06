import { describe, expect, it } from "vitest";
import {
  firstOutOfRange,
  settingsForForm,
  teamSignalSettingsSchema,
} from "../team-signals";
import {
  ATTENTION,
  attentionReasons,
  attentionRules,
  signalReason,
  signalsFromDigestRow,
  thresholdsFrom,
  type TeamOverviewRow,
} from "../team-overview";

const row: TeamOverviewRow = {
  user_id: "u1",
  organization_id: "o1",
  role: "staff",
  full_name: "Sam Rivera",
  avatar_url: null,
  title: null,
  open_tasks: 4,
  overdue: 0,
  oldest_overdue_due: null,
  due_this_week: 1,
  blocked: 0,
  blocked_stale: 0,
  in_progress_stale: 0,
  completed_7: 2,
  completed_prev_7: 1,
  completed_30: 5,
  open_decisions: 0,
  overdue_decisions: 0,
  last_activity_at: null,
};

describe("settings form", () => {
  it("reads a missing row as the agreed defaults, with reminders and the digest off", () => {
    expect(settingsForForm(null)).toEqual({
      overdueCount: 3,
      overdueAgeDays: 7,
      blockedNoUpdateDays: 5,
      inProgressNoUpdateDays: 7,
      flagProjectReports: true,
      flagOverdueDecisions: true,
      remindersEnabled: false,
      digestEnabled: false,
    });
  });

  it("accepts whole numbers in range and refuses anything else", () => {
    const valid = { ...settingsForForm(null), overdueCount: "4" };
    expect(teamSignalSettingsSchema.safeParse(valid).success).toBe(true);
    expect(teamSignalSettingsSchema.safeParse({ ...valid, overdueCount: 0 }).success).toBe(false);
    expect(teamSignalSettingsSchema.safeParse({ ...valid, overdueAgeDays: 2.5 }).success).toBe(false);
    expect(teamSignalSettingsSchema.safeParse({ ...valid, blockedNoUpdateDays: 366 }).success).toBe(false);
  });

  it("names the first field out of range", () => {
    expect(firstOutOfRange({ overdueCount: 3, overdueAgeDays: 7, blockedNoUpdateDays: 0, inProgressNoUpdateDays: 7 })).toBe(
      "blockedNoUpdateDays",
    );
    expect(firstOutOfRange({ overdueCount: 3, overdueAgeDays: 7, blockedNoUpdateDays: 5, inProgressNoUpdateDays: 7 })).toBeNull();
  });
});

describe("thresholds", () => {
  it("fills anything unset with the defaults", () => {
    expect(thresholdsFrom(null)).toEqual(ATTENTION);
    expect(thresholdsFrom({ overdue_count: 5 }).overdueCount).toBe(5);
    expect(thresholdsFrom({ overdue_count: 5 }).overdueAgeDays).toBe(7);
  });

  it("applies the organization's overdue count and age", () => {
    const flagged = { ...row, overdue: 2, oldest_overdue_due: "2026-09-24" };
    expect(attentionReasons(flagged, "2026-09-26")).toEqual([]);
    expect(
      attentionReasons(flagged, "2026-09-26", 0, undefined, { ...ATTENTION, overdueCount: 2 }),
    ).toEqual(["2 tasks overdue, oldest 2 days"]);
    expect(
      attentionReasons({ ...row, overdue: 1, oldest_overdue_due: "2026-09-14" }, "2026-09-26", 0, undefined, {
        ...ATTENTION,
        overdueAgeDays: 30,
      }),
    ).toEqual([]);
  });

  it("words the blocked and in-progress reasons with the organization's ages", () => {
    expect(
      attentionReasons({ ...row, blocked_stale: 1 }, "2026-09-26", 0, undefined, {
        ...ATTENTION,
        blockedNoUpdateDays: 10,
      }),
    ).toEqual(["1 blocked task with no update for 10+ days"]);
  });

  it("leaves out project reports and decisions when those rules are off", () => {
    expect(
      attentionReasons({ ...row, overdue_decisions: 2 }, "2026-09-26", 3, undefined, {
        ...ATTENTION,
        flagProjectReports: false,
        flagOverdueDecisions: false,
      }),
    ).toEqual([]);
  });

  it("lists the rules in force", () => {
    expect(attentionRules(ATTENTION)).toEqual([
      "3 or more overdue tasks",
      "a task overdue by more than 7 days",
      "a blocked task with no update for 5 days",
      "a task in progress with no update for 7 days",
      "a project report overdue",
      "a decision past its due date",
    ]);
    expect(attentionRules({ ...ATTENTION, flagProjectReports: false, flagOverdueDecisions: false })).toHaveLength(4);
  });
});

describe("signals", () => {
  it("words each signal exactly as the overview words the same reason", () => {
    const today = "2026-09-26";
    const overviewReasons = attentionReasons(
      { ...row, overdue: 4, oldest_overdue_due: "2026-09-14", blocked_stale: 1, in_progress_stale: 2, overdue_decisions: 1 },
      today,
      1,
    );
    const signalReasons = signalsFromDigestRow({
      kinds: ["overdue", "blocked", "in_progress", "project_reports", "decisions"],
      overdue: 4,
      oldest_overdue_days: 12,
      blocked_stale: 1,
      in_progress_stale: 2,
      stale_projects: 1,
      overdue_decisions: 1,
    }).map((signal) => signalReason(signal));
    expect(signalReasons).toEqual(overviewReasons);
  });

  it("keeps only the signals the database reported, in a fixed order", () => {
    const signals = signalsFromDigestRow({
      kinds: ["decisions", "overdue"],
      overdue: "3",
      oldest_overdue_days: 2,
      blocked_stale: "1",
      in_progress_stale: "0",
      stale_projects: "0",
      overdue_decisions: "1",
    });
    expect(signals.map((signal) => signal.kind)).toEqual(["overdue", "decisions"]);
    expect(signals[0]).toEqual({ kind: "overdue", count: 3, oldestDays: 2 });
  });
});
