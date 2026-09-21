import { describe, expect, it } from "vitest";
import {
  applyTaskFilters,
  describeFilterConflicts,
  dueWindowRange,
  escapeLikePattern,
  parseTaskFilters,
  taskSelectFor,
  type FilterableQuery,
} from "@/features/tasks/filters";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

/** Records the calls a filter set makes, so the composition can be asserted. */
function recorder() {
  const calls: string[] = [];
  const query = new Proxy({} as FilterableQuery, {
    get(_target, prop: string) {
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return query;
      };
    },
  });
  return { query, calls };
}

describe("task filter parsing", () => {
  it("reads every dimension P0-TSK-08 requires", () => {
    const filters = parseTaskFilters({
      program: UUID_A,
      project: UUID_B,
      owner: UUID_A,
      status: "in_review",
      priority: "high",
      due: "week",
      milestone: UUID_B,
      label: UUID_A,
      blocked: "yes",
      q: "budget",
    });
    expect(Object.keys(filters).sort()).toEqual([
      "blocked",
      "due",
      "label",
      "milestone",
      "owner",
      "priority",
      "program",
      "project",
      "q",
      "status",
    ]);
  });

  it("drops an unrecognised value instead of rejecting the request", () => {
    // These arrive from links people paste and hand-edit. A stale parameter
    // should cost you that one filter, not the page.
    const filters = parseTaskFilters({
      status: "not_a_status",
      project: "definitely-not-a-uuid",
      priority: "high",
    });
    expect(filters).toEqual({ priority: "high" });
  });

  it("ignores blank and repeated parameters", () => {
    expect(parseTaskFilters({ q: "   ", status: ["in_progress", "ready"] })).toEqual({
      status: "in_progress",
    });
  });
});

describe("due windows", () => {
  it("treats overdue as strictly before today", () => {
    expect(dueWindowRange("overdue", "2026-09-17")).toEqual({ to: "2026-09-16" });
  });

  it("spans seven days inclusive for the week", () => {
    expect(dueWindowRange("week", "2026-09-17")).toEqual({
      from: "2026-09-17",
      to: "2026-09-23",
    });
  });

  it("crosses a month boundary correctly", () => {
    expect(dueWindowRange("week", "2026-09-29").to).toBe("2026-10-05");
  });

  it("asks for a null date rather than a range when unscheduled", () => {
    expect(dueWindowRange("none", "2026-09-17")).toEqual({ isNull: true });
  });
});

describe("free-text search", () => {
  it("escapes wildcards so a literal search stays literal", () => {
    // Unescaped, "100%" matches every title, which answers a question nobody
    // asked.
    expect(escapeLikePattern("100% _done")).toBe("100\\% \\_done");
  });
});

describe("applying filters", () => {
  it("limits to open statuses when no status is chosen", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, {}, "2026-09-17");
    expect(calls[0]).toContain("in(");
    expect(calls[0]).toContain("not_started");
    expect(calls[0]).not.toContain("completed");
  });

  it("uses the chosen status instead of the open set", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, { status: "completed" }, "2026-09-17");
    expect(calls).toContain('eq("status","completed")');
    expect(calls.some((c) => c.startsWith("in("))).toBe(false);
  });

  it("excludes unscheduled tasks from a due window", () => {
    // An undated task is not overdue. Without this it would pass a `lte`
    // comparison against null and quietly vanish from both sides.
    const { query, calls } = recorder();
    applyTaskFilters(query, { due: "overdue" }, "2026-09-17");
    expect(calls).toContain('not("due_at","is",null)');
    expect(calls).toContain('lte("due_at","2026-09-16")');
  });

  it("maps blocked state onto the status it is defined by", () => {
    const { calls: yes } = (() => {
      const r = recorder();
      applyTaskFilters(r.query, { blocked: "yes" }, "2026-09-17");
      return r;
    })();
    const { calls: no } = (() => {
      const r = recorder();
      applyTaskFilters(r.query, { blocked: "no" }, "2026-09-17");
      return r;
    })();
    expect(yes).toContain('eq("status","blocked")');
    expect(no).toContain('neq("status","blocked")');
  });

  it("filters labels through the joined column", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, { label: UUID_A }, "2026-09-17");
    expect(calls).toContain(`eq("task_label.label_id","${UUID_A}")`);
  });

  it("only joins task_label when a label is actually filtered", () => {
    expect(taskSelectFor({}, "id, title")).toBe("id, title");
    expect(taskSelectFor({ label: UUID_A }, "id, title")).toBe(
      "id, title, task_label!inner(label_id)",
    );
  });
});

/**
 * #76: two filter combinations returned nothing and said nothing about why.
 *
 * Returning nothing is the correct answer to "ready and blocked" — no task
 * holds two statuses. The defect was the silence, so these cover both halves:
 * the query stops repeating itself, and the contradiction is describable.
 */
describe("filter combinations that cannot match", () => {
  it("keeps a contradiction contradictory rather than quietly widening it", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, { status: "ready", blocked: "yes" }, "2026-09-19");
    // Both conditions are emitted on purpose. Dropping either one would turn
    // an impossible question into a plausible answer — a list of Ready tasks
    // under a notice saying nothing can match, which is worse than an empty
    // list. Zero rows is right; the notice is what was missing.
    expect(calls).toContain('eq("status","ready")');
    expect(calls).toContain('eq("status","blocked")');
  });

  it("drops the blocked condition when the status filter already said it", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, { status: "blocked", blocked: "yes" }, "2026-09-19");
    expect(calls.filter((call) => call.startsWith('eq("status"'))).toEqual([
      'eq("status","blocked")',
    ]);
  });

  it("still applies the blocked filter when it is the only status asked for", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, { blocked: "yes" }, "2026-09-19");
    expect(calls).toContain('eq("status","blocked")');
  });

  it("keeps blocked-and-not-blocked empty", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, { status: "blocked", blocked: "no" }, "2026-09-19");
    expect(calls).toContain('eq("status","blocked")');
    expect(calls).toContain('neq("status","blocked")');
  });

  it("drops a not-blocked condition any other status already implies", () => {
    const { query, calls } = recorder();
    applyTaskFilters(query, { status: "ready", blocked: "no" }, "2026-09-19");
    // A Ready task is not blocked by definition, so the extra `neq` only made
    // the query longer.
    expect(calls).not.toContain('neq("status","blocked")');
  });

  it("names the contradiction rather than leaving an empty list to explain itself", () => {
    const conflicts = describeFilterConflicts(
      { status: "ready", blocked: "yes" },
      { statusLabel: () => "Ready" },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("Ready");
    expect(conflicts[0]).toContain("blocked");
  });

  it("treats blocked plus the blocked status as agreement, not conflict", () => {
    expect(describeFilterConflicts({ status: "blocked", blocked: "yes" })).toEqual([]);
  });

  it("flags an owner filter on a page that only shows one person's work", () => {
    const conflicts = describeFilterConflicts(
      { owner: UUID_B },
      { scopedToUserId: UUID_A },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("your own work");
  });

  it("says nothing when the owner filter names the viewer", () => {
    expect(
      describeFilterConflicts({ owner: UUID_A }, { scopedToUserId: UUID_A }),
    ).toEqual([]);
  });

  it("says nothing about an owner filter on a page that shows everyone", () => {
    expect(describeFilterConflicts({ owner: UUID_B })).toEqual([]);
  });

  it("reports an ordinary filter set as fine", () => {
    expect(
      describeFilterConflicts(
        { status: "in_progress", priority: "high", project: UUID_A },
        { scopedToUserId: UUID_A },
      ),
    ).toEqual([]);
  });
});
