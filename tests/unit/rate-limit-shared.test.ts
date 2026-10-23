import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: { action: string; error: unknown }[] = [];
vi.mock("@/lib/server-log", () => ({
  logActionFailure: (action: string, error: unknown) => logged.push({ action, error }),
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc }) }));

const { RATE_LIMITS, grantWriteAllowance } = await import("@/lib/rate-limit");
const { dbErrorMessage, knownDbErrorMessage } = await import("@/lib/db-error");
const { createTranslator } = await import("@/lib/i18n/translate");

/**
 * The database enforces per-person insert limits on the tables people can
 * write to directly (SEC-024), under the same action names and values as the
 * app's RATE_LIMITS. A refusal carries SQLSTATE RL429, shown in the reader's
 * language. An import asks the database for room for its rows first.
 */

function databaseRules(): Map<string, { limit: number; windowSeconds: number }> {
  const dir = join(process.cwd(), "supabase/migrations");
  const rules = new Map<string, { limit: number; windowSeconds: number }>();
  for (const name of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, name), "utf8");
    for (const block of sql.matchAll(/insert into app_limits\.rule[^;]*;/gs)) {
      for (const row of block[0].matchAll(/\('([a-z-]+:[a-z-]+)',\s*(\d+),\s*(\d+)\)/g)) {
        rules.set(row[1], { limit: Number(row[2]), windowSeconds: Number(row[3]) });
      }
    }
  }
  return rules;
}

describe("limits shared by the app and the database", () => {
  it("names every database rule in RATE_LIMITS, with the same limit and window", () => {
    const rules = databaseRules();
    expect(rules.size).toBeGreaterThanOrEqual(8);
    for (const [action, rule] of rules) {
      expect(RATE_LIMITS[action as keyof typeof RATE_LIMITS], action).toEqual(rule);
    }
  });
});

describe("a write refused for going too fast", () => {
  const refusal = { code: "RL429", message: "rate_limited: too many changes in a short time", hint: "task:create" };
  beforeEach(() => {
    logged.length = 0;
  });

  it("reads as too many changes, try again shortly, in English and French", () => {
    expect(knownDbErrorMessage(createTranslator("en"), refusal, [])).toBe(
      "Too many changes in a short time. Wait a moment and try again.",
    );
    expect(knownDbErrorMessage(createTranslator("fr-CA"), refusal, [])).toBe(
      "Trop de modifications en peu de temps. Attendez un instant, puis réessayez.",
    );
    expect(dbErrorMessage(createTranslator("en"), refusal, "Could not save.", { action: "task.create", rules: [] })).toBe(
      "Too many changes in a short time. Wait a moment and try again.",
    );
    expect(logged).toEqual([]);
  });

  it("is told by its code, not its words", () => {
    expect(knownDbErrorMessage(createTranslator("en"), { message: refusal.message }, [])).toBeNull();
  });
});

describe("an import's allowance", () => {
  beforeEach(() => rpc.mockReset());

  it("asks the database for room for its rows, for ten minutes", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await grantWriteAllowance("task:create", "user-1", 1500)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("grant_write_allowance", {
      p_user: "user-1",
      p_action: "task:create",
      p_count: 1500,
      p_seconds: 600,
    });
  });

  it("says so when it could not, so the import can stop before writing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await grantWriteAllowance("task:create", "user-1", 10)).toBe(false);
  });
});
