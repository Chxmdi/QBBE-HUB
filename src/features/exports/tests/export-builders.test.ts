import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExport } from "../services/export-builders";

function database(tables: Record<string, Record<string, unknown>[]>, failPage = false) {
  return { from(table: string) {
    let rows = tables[table] ?? [];
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return query; },
      is(key: string, value: unknown) { return query.eq(key, value); },
      order() { return query; },
      async maybeSingle() { return { data: rows[0] ?? null, error: null }; },
      async range(start: number, end: number) {
        if (failPage && start > 0) return { data: null, error: { message: "offline" } };
        // Emulate an API cap below the requested page size.
        return { data: rows.slice(start, Math.min(end + 1, start + 200)), error: null };
      },
    };
    return query;
  } } as unknown as SupabaseClient;
}

describe("export data boundaries", () => {
  it("exports every row beyond the API cap, excluding other organizations", async () => {
    const rows = Array.from({ length: 1205 }, (_, id) => ({ id, organization_id: "ours" }));
    const result = await buildExport(database({ task: [...rows, { id: "foreign", organization_id: "other" }] }),
      "task_history", { organizationId: "ours", subjectUserId: null, params: {} });
    expect(result.rowCount).toBe(1205);
    expect(result.sections[0].rows).toEqual(rows);
  });

  it("fails instead of returning a partial export when a later page fails", async () => {
    const task = Array.from({ length: 300 }, (_, id) => ({ id, organization_id: "ours" }));
    await expect(buildExport(database({ task }, true), "task_history",
      { organizationId: "ours", subjectUserId: null, params: {} })).rejects.toThrow("offline");
  });

  it("refuses a person outside the requested organization", async () => {
    await expect(buildExport(database({}), "person_data",
      { organizationId: "ours", subjectUserId: "foreign", params: {} })).rejects.toThrow("does not belong");
  });

  it("scopes messages and email to the subject and organization", async () => {
    const result = await buildExport(database({
      organization_membership: [{ user_id: "person", organization_id: "ours" }],
      user_profile: [{ id: "person" }],
      message: [
        { id: "yes", organization_id: "ours", author_id: "person", deleted_at: null },
        { id: "no", organization_id: "other", author_id: "person", deleted_at: null },
      ],
      email_delivery: [
        { id: "yes", organization_id: "ours", recipient_user_id: "person" },
        { id: "no", organization_id: "other", recipient_user_id: "person" },
      ],
    }), "person_data", { organizationId: "ours", subjectUserId: "person", params: {} });
    expect(result.sections.find(s => s.name === "messages_written")?.rows.map(r => r.id)).toEqual(["yes"]);
    expect(result.sections.find(s => s.name === "email_deliveries")?.rows.map(r => r.id)).toEqual(["yes"]);
  });
});
