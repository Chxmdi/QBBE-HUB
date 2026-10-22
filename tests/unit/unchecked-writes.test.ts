import { describe, expect, it } from "vitest";
import { findUncheckedWrites, readAllowlist, scan, violations } from "../../scripts/ci/check-unchecked-writes.mjs";

/**
 * A database write whose `{ error }` nobody reads reports success whatever
 * happened. The ones that existed when this check was added are counted per
 * file in scripts/ci/unchecked-writes-allowlist.json; that count may only go
 * down.
 */
describe("unchecked database writes", () => {
  it("finds a bare insert, update, upsert or delete, including a chain split over lines", () => {
    const source = [
      'await supabase.from("audit_event").insert({ action: "x" });',
      "await db",
      '  .from("notification")',
      "  .update({ read_at: now })",
      '  .eq("id", id);',
      'await supabase.from("x").upsert(row);',
      'await supabase.from("x").delete().eq("id", id);',
    ].join("\n");
    expect(findUncheckedWrites(source)).toEqual([1, 2, 6, 7]);
  });

  it("finds a dropped database function result, and an ignored audit in a route", () => {
    const source = ['await supabase.rpc("add_channel_member", args);', 'await recordAudit(supabase, row);'].join("\n");
    expect(findUncheckedWrites(source)).toEqual([1]);
    expect(findUncheckedWrites(source, { route: true })).toEqual([1, 2]);
  });

  it("does not take Array.from or Buffer.from for a table", () => {
    expect(findUncheckedWrites('await Buffer.from(text).update(hash);')).toEqual([]);
  });

  it("leaves alone a write whose result is read, and reads that are not writes", () => {
    const source = [
      'const { error } = await supabase.from("x").insert(row);',
      'if (!(await recordAudit(supabase, row))) return refuse();',
      'await supabase.from("x").select("id").eq("status", "update(");',
      'return await supabase.from("x").delete();',
      'await recordAudit(supabase, { action: "insert" });',
    ].join("\n");
    expect(findUncheckedWrites(source)).toEqual([]);
  });

  it("rejects a file that gains an unchecked write", () => {
    expect(violations({ "src/a.ts": [3, 9] }, { "src/a.ts": 1 })).toEqual([
      { path: "src/a.ts", lines: [3, 9], allowed: 1 },
    ]);
    expect(violations({ "src/new.ts": [4] }, {})).toHaveLength(1);
    expect(violations({ "src/a.ts": [3] }, { "src/a.ts": 1 })).toEqual([]);
  });

  it("rejects an allowance left higher than the count, so it cannot be reused", () => {
    expect(violations({ "src/a.ts": [3] }, { "src/a.ts": 2 })).toHaveLength(1);
    expect(violations({}, { "src/gone.ts": 1 })).toHaveLength(1);
  });

  it("matches the allowlist exactly in src", () => {
    const bad = violations(scan(), readAllowlist()) as { path: string; lines: number[] }[];
    expect(bad.map(({ path, lines }) => `${path}: lines ${lines.join(", ")}`)).toEqual([]);
  });
});
