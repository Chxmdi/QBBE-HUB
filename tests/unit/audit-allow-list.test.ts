import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * record_audit_event accepts only the (event type, action, object type) entries listed in
 * its migration. An entry the app sends that is not listed is refused, and
 * an export behind it is refused too. Every pair the app names in a
 * recordAudit call, or as a ledger export's action, must be on the list.
 */

const migrations = path.resolve(__dirname, "../../supabase/migrations");
const migration = readdirSync(migrations).find((file) => file.endsWith("_audit_writes_through_function.sql"))!;
const sql = readFileSync(path.join(migrations, migration), "utf8");
const allowed = new Set([...sql.matchAll(/\('([a-z_]+)', '([a-z0-9_.:-]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}/${m[2]}/${m[3]}`));

const files = (readdirSync(path.resolve(__dirname, "../../src"), { recursive: true }) as string[])
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => path.join("src", file));

function sentPairs(): string[] {
  const pairs: string[] = [];
  for (const file of files) {
    const source = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    for (const call of source.matchAll(/recordAudit(?:Id)?\(\w+, \{([\s\S]*?)\n\s*\}\)/g)) {
      const eventType = /event_type: "([a-z_]+)"/.exec(call[1])?.[1];
      const action = /action: ([^,\n]+)/.exec(call[1])?.[1];
      const objectType = /object_type: "([a-z_]+)"/.exec(call[1])?.[1];
      if (!eventType || !action || !objectType) continue;
      // The names it can take, not the values it compares against.
      for (const literal of action.replace(/[!=]==\s*"[^"]*"/g, "").matchAll(/"([a-z0-9_.:-]+)"/g)) pairs.push(`${eventType}/${literal[1]}/${objectType}`);
    }
    // Ledger exports name their action in csvResponse(…, "x_exported", …).
    for (const call of source.matchAll(/csvResponse\(\s*\w+,\s*\w+,\s*([^,]+(?:\?[^,]+:[^,]+)?),/g)) {
      for (const literal of call[1].matchAll(/"([a-z0-9_]+_exported)"/g)) pairs.push(`ledger/${literal[1]}/organization`);
    }
  }
  return pairs;
}

describe("audit entries the app records", () => {
  it("are all on the database's list", () => {
    expect(allowed.size).toBeGreaterThan(50);
    const pairs = sentPairs();
    expect(pairs.length).toBeGreaterThan(40);
    expect(pairs.filter((pair) => !allowed.has(pair))).toEqual([]);
  });

  it("include no entry that only database functions write", () => {
    for (const pair of ["ledger/entry_posted", "ledger/entry_reversed", "access/user_deactivated", "operations/unregistered_uploads_deleted"]) {
      expect([...allowed].some((entry) => entry.startsWith(`${pair}/`)), pair).toBe(false);
    }
  });
});
