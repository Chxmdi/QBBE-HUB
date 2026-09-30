import { describe, expect, it } from "vitest";
import { formattersFor } from "@/lib/i18n/format";
import { DIGEST_LIMIT, buildDigest, type DigestActivity, type DigestInput } from "../digest";
import { digestDetail } from "../components/digest-section";
import { homeT } from "../i18n";
import { ME, OTHER } from "./fixtures";

const SINCE = "2026-10-05T12:00:00Z";
let n = 0;

function change(overrides: Partial<DigestActivity> = {}): DigestActivity {
  n += 1;
  return {
    id: `a${n}`,
    actor_id: OTHER,
    verb: "updated",
    source_type: "task",
    source_id: "t1",
    project_id: null,
    summary: "updated a task",
    created_at: "2026-10-06T10:00:00Z",
    metadata: null,
    actor: { full_name: "Grace" },
    ...overrides,
  };
}

function input(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    userId: ME,
    since: SINCE,
    followedTaskIds: new Set(["t1", "t2", "t3"]),
    followedProjectIds: new Set(["p1"]),
    taskTitles: new Map([
      ["t1", "Book the hall"],
      ["t2", "Order chairs"],
      ["t3", "Print posters"],
    ]),
    activity: [],
    approvalsForMe: [],
    myDecidedRequests: [],
    measurements: [],
    statusUpdates: [],
    ...overrides,
  };
}

const status = (from: string, to: string) => ({ changes: [{ field: "status", from, to }] });

describe("buildDigest", () => {
  it("ranks by the rules: blocked, approvals, deadlines, health, numbers, completions, other statuses", () => {
    const digest = buildDigest(
      input({
        activity: [
          change({ source_id: "t3", metadata: status("not_started", "in_progress") }),
          change({ source_id: "t2", metadata: status("in_progress", "completed") }),
          change({ source_id: "t1", metadata: { changes: [{ field: "due_at", from: "2026-10-20", to: "2026-10-25" }] } }),
          change({ source_id: "t2", metadata: { changes: [{ field: "status", from: "ready", to: "blocked" }, { field: "blocked_reason", from: null, to: "No quote" }] } }),
        ],
        approvalsForMe: [{ id: "ap1", note: "Deposit", created_at: "2026-10-06T09:00:00Z", requested_by_name: "Ada" }],
        myDecidedRequests: [{ id: "ap2", note: "Budget", decision: "approved", decided_at: "2026-10-06T08:00:00Z" }],
        statusUpdates: [
          { id: "u1", project_id: "p1", project_name: "Gala", health: "at_risk", previous: "on_track", created_at: "2026-10-06T07:00:00Z" },
        ],
        measurements: [
          { id: "m1", metric_id: "x", metric_name: "Attendance", unit: "people", value: 55, previous: 40, created_at: "2026-10-06T06:00:00Z", href: "/programs/p" },
        ],
      }),
    );
    expect(digest.map((entry) => entry.kind)).toEqual([
      "newly_blocked",
      "approval_requested",
      "deadline_moved",
      "health_changed",
      "approval_decided",
      "number_changed",
      "completed",
      "status_changed",
    ]);
    expect(digest[0]).toMatchObject({ title: "Order chairs", href: "/my-work?task=t2", by: "Grace", detail: { reason: "No quote" } });
  });

  it("puts a deadline moved sooner, and a project now off track, higher", () => {
    const digest = buildDigest(
      input({
        activity: [
          change({ source_id: "t1", metadata: { changes: [{ field: "due_at", from: "2026-10-20", to: "2026-10-25" }] } }),
          change({ source_id: "t2", metadata: { changes: [{ field: "due_at", from: "2026-10-20", to: "2026-10-10" }] } }),
        ],
        statusUpdates: [
          { id: "u1", project_id: "p1", project_name: "Gala", health: "off_track", previous: "at_risk", created_at: "2026-10-06T07:00:00Z" },
        ],
      }),
    );
    expect(digest.map((entry) => [entry.kind, entry.weight])).toEqual([
      ["deadline_moved", 60],
      ["health_changed", 55],
      ["deadline_moved", 50],
    ]);
    expect(digest[0].detail).toEqual({ kind: "deadline_moved", from: "2026-10-20", to: "2026-10-10", sooner: true });
  });

  it("leaves out my own changes, older changes, unfollowed work and no-op values", () => {
    const digest = buildDigest(
      input({
        activity: [
          change({ actor_id: ME, metadata: status("ready", "blocked") }),
          change({ created_at: "2026-10-01T00:00:00Z", metadata: status("ready", "blocked") }),
          change({ source_id: "unfollowed", metadata: status("ready", "blocked") }),
          change({ metadata: { changes: [{ field: "priority", from: "low", to: "high" }] } }),
        ],
        approvalsForMe: [{ id: "old", note: null, created_at: "2026-10-01T00:00:00Z", requested_by_name: null }],
        statusUpdates: [
          { id: "u1", project_id: "p1", project_name: "Gala", health: "on_track", previous: "on_track", created_at: "2026-10-06T07:00:00Z" },
        ],
        measurements: [
          { id: "m1", metric_id: "x", metric_name: "Attendance", unit: null, value: 40, previous: 40, created_at: "2026-10-06T06:00:00Z", href: "/" },
        ],
      }),
    );
    expect(digest).toEqual([]);
  });

  it("follows other people's tasks in followed projects", () => {
    const digest = buildDigest(
      input({ activity: [change({ source_id: "someone-elses", project_id: "p1", summary: "moved “Venue”", metadata: status("ready", "blocked") })] }),
    );
    expect(digest).toHaveLength(1);
    expect(digest[0].title).toBe("moved “Venue”");
  });

  it("folds repeated changes to one record into the latest, with a count", () => {
    const digest = buildDigest(
      input({
        activity: [
          change({ created_at: "2026-10-06T10:00:00Z", metadata: { changes: [{ field: "due_at", from: "2026-10-20", to: "2026-10-22" }] } }),
          change({ created_at: "2026-10-07T10:00:00Z", metadata: { changes: [{ field: "due_at", from: "2026-10-22", to: "2026-10-24" }] } }),
        ],
      }),
    );
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({ count: 2, at: "2026-10-07T10:00:00Z", detail: { from: "2026-10-22", to: "2026-10-24" } });
  });

  it("is a total order, and capped", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      change({ source_id: `t${index}`, created_at: "2026-10-06T10:00:00Z", metadata: status("ready", "in_progress") }),
    );
    const followedTaskIds = new Set(many.map((activity) => activity.source_id));
    const one = buildDigest(input({ activity: many, followedTaskIds }));
    const two = buildDigest(input({ activity: [...many].reverse(), followedTaskIds }));
    expect(one).toHaveLength(DIGEST_LIMIT);
    expect(one).toEqual(two);
  });

  it("marks project completions recorded without a field change", () => {
    const digest = buildDigest(input({ activity: [change({ source_type: "project", source_id: "p1", verb: "completed", summary: "completed project “Gala”" })] }));
    expect(digest[0]).toMatchObject({ kind: "completed", href: "/projects/p1" });
  });
});

describe("digest details in words", () => {
  const format = formattersFor("en");
  const t = homeT("en");
  const detail = (entry: Parameters<typeof digestDetail>[0]) => digestDetail(entry, t, format, "America/Toronto");
  const base = { key: "k", weight: 0, at: SINCE, title: "x", href: "/", by: null, count: 1 };

  it("say what moved and by how much", () => {
    expect(detail({ ...base, kind: "deadline_moved", detail: { kind: "deadline_moved", from: "2026-10-20", to: "2026-10-10", sooner: true } })).toMatch(
      /^Moved sooner: .+ to .+$/,
    );
    expect(detail({ ...base, kind: "deadline_moved", detail: { kind: "deadline_moved", from: "2026-10-20", to: null, sooner: false } })).toMatch(
      /^Due date removed/,
    );
    expect(detail({ ...base, kind: "status_changed", detail: { kind: "status_changed", from: "ready", to: "in_progress" } })).toBe(
      "Ready to In progress",
    );
    expect(detail({ ...base, kind: "health_changed", detail: { kind: "health_changed", from: "on_track", to: "at_risk" } })).toBe(
      "On track to At risk",
    );
    expect(detail({ ...base, kind: "number_changed", detail: { kind: "number_changed", from: 40, to: 55, unit: "people" } })).toBe(
      "40 people to 55 people",
    );
    expect(detail({ ...base, kind: "approval_decided", detail: { kind: "approval_decided", decision: "approved" } })).toBe("Approved");
    const fr = digestDetail(
      { ...base, kind: "health_changed", detail: { kind: "health_changed", from: "on_track", to: "off_track" } },
      homeT("fr-CA"),
      formattersFor("fr-CA"),
      "America/Toronto",
    );
    expect(fr).toBe("Sur la bonne voie à Hors de la voie");
  });
});
