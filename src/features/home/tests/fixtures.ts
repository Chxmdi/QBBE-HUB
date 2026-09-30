import type { HomeActivity, HomeData, HomeTask } from "../model";

export const ME = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
/** 2026-10-07 15:00 in Toronto. */
export const NOW = new Date("2026-10-07T19:00:00Z");

let counter = 0;
export function task(overrides: Partial<HomeTask> = {}): HomeTask {
  counter += 1;
  return {
    id: `t${counter}`,
    title: `Task ${counter}`,
    status: "not_started",
    priority: "medium",
    due_at: null,
    assignee_id: ME,
    requester_id: ME,
    reviewer_id: null,
    approver_id: null,
    project_id: null,
    blocked_reason: null,
    updated_at: "2026-10-06T12:00:00Z",
    ...overrides,
  };
}

export function activity(overrides: Partial<HomeActivity> = {}): HomeActivity {
  counter += 1;
  return {
    id: `a${counter}`,
    actor_id: ME,
    verb: "updated",
    source_type: "task",
    source_id: "t0",
    project_id: null,
    summary: `activity ${counter}`,
    created_at: "2026-10-07T12:00:00Z",
    ...overrides,
  };
}

export function data(overrides: Partial<HomeData> = {}): HomeData {
  return {
    userId: ME,
    now: NOW,
    timeZone: "America/Toronto",
    tasks: [],
    meetings: [],
    projects: [],
    approvals: [],
    decisions: [],
    activity: [],
    mentions: [],
    ...overrides,
  };
}
