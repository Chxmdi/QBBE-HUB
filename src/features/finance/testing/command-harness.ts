import { expect, it, vi } from "vitest";
import { fakeDb, type Answer, type RpcCall, type TableCall } from "@/lib/objects/testing/fake-db";

/**
 * Shared stand-ins for the finance Server Actions' unit tests: who is calling,
 * whether they are rate limited, and what the database answers. Each test file
 * mocks the modules with these (an async vi.mock factory importing this file)
 * and sets `harness` per case. Test support only.
 */

export const ORG = "22222222-2222-4222-8222-222222222222";
export const ME = "11111111-1111-4111-8111-111111111111";
export const ID = "33333333-3333-4333-8333-333333333333";

/** A refusal written for people (a ledger rule) and one that is not (row security). */
export const READABLE = { code: "23514", message: "The period is closed." };
export const RLS = { code: "42501", message: 'new row violates row-level security policy for table "journal_entry"' };

export const harness = {
  admin: true,
  staff: true,
  limited: false,
  rpc: (() => ({ data: null, error: null })) as (call: RpcCall) => Answer,
  table: (() => ({ data: null, error: null })) as (call: TableCall) => Answer,
  rpcCalls: [] as RpcCall[],
  tableCalls: [] as TableCall[],
  revalidated: 0,
};

export function resetHarness() {
  harness.admin = true;
  harness.staff = true;
  harness.limited = false;
  harness.rpc = () => ({ data: null, error: null });
  harness.table = () => ({ data: null, error: null });
  harness.rpcCalls = [];
  harness.tableCalls = [];
  harness.revalidated = 0;
}

/** True when no database call was made at all. */
export const untouched = () => harness.rpcCalls.length === 0 && harness.tableCalls.length === 0;

const session = () => ({
  userId: ME,
  organizationId: ORG,
  role: harness.admin ? "admin" : "staff",
  isAdmin: harness.admin,
  isStaff: harness.staff,
});

export const authMock = {
  authorizeAdminAction: vi.fn(async () =>
    harness.admin
      ? { ok: true as const, session: session() }
      : { ok: false as const, error: "admin required", reason: "role" as const },
  ),
  requireStaff: vi.fn(async () => {
    if (!harness.staff) throw new Error("redirect: not staff");
    return session();
  }),
  requireSession: vi.fn(async () => session()),
  getSessionContext: vi.fn(async () => session()),
};

export const rateLimitMock = {
  enforceRateLimit: vi.fn(async () => (harness.limited ? { ok: false as const, error: "slow down" } : null)),
};

export const supabaseMock = {
  createSupabaseServerClient: vi.fn(async () => {
    const fake = fakeDb({
      rpc: (call) => {
        harness.rpcCalls.push(call);
        return harness.rpc(call);
      },
      table: (call) => {
        harness.tableCalls.push(call);
        return harness.table(call);
      },
    });
    return fake.db;
  }),
};

export const i18nMock = {
  getT: async () => (key: string) => key,
  getLocale: async () => "en",
};

export const cacheMock = {
  revalidatePath: () => {
    harness.revalidated += 1;
  },
};

type Result = { ok: boolean; error?: string };
/** A command called with valid input, and which gate it sits behind. */
export type ValidCall = [name: string, call: () => Promise<Result>, gate: "admin" | "staff"];

/**
 * What every finance write must do, whatever it writes: refuse a caller below
 * its gate and one over the rate limit before touching the database; on
 * success, refresh the pages; on a refusal, show a rule's own sentence but
 * never a row-security or permission message, and refresh nothing.
 */
export function commandContract(valid: ValidCall[], fallbackPrefix: RegExp) {
  it.each(valid)("%s refuses a caller below its gate, before the database", async (_name, call, gate) => {
    harness.admin = false;
    if (gate === "admin") {
      expect(await call()).toEqual({ ok: false, error: "admin required" });
    } else {
      harness.staff = false;
      await expect(call()).rejects.toThrow(/not staff/);
    }
    expect(untouched()).toBe(true);
  });

  it.each(valid)("%s stops a caller over the rate limit", async (_name, call) => {
    harness.limited = true;
    expect(await call()).toEqual({ ok: false, error: "slow down" });
    expect(untouched()).toBe(true);
  });

  it.each(valid)("%s succeeds and refreshes its pages", async (_name, call) => {
    expect(await call()).toMatchObject({ ok: true });
    expect(harness.rpcCalls.length + harness.tableCalls.length).toBeGreaterThan(0);
    expect(harness.revalidated).toBeGreaterThan(0);
  });

  it.each(valid)("%s shows a rule's own sentence, and never a row-security message", async (_name, call) => {
    harness.rpc = () => ({ data: null, error: READABLE });
    harness.table = () => ({ data: null, error: READABLE });
    expect(await call()).toEqual({ ok: false, error: READABLE.message });

    harness.revalidated = 0;
    harness.rpc = () => ({ data: null, error: RLS });
    harness.table = () => ({ data: null, error: RLS });
    const refused = await call();
    expect(refused.ok).toBe(false);
    expect(refused.error).not.toMatch(/row-level security|permission denied/);
    expect(refused.error).toMatch(fallbackPrefix);
    expect(harness.revalidated).toBe(0);
  });
}

/**
 * Every exported command, not only the ones with a valid call above, refuses
 * a caller who is neither staff nor an administrator before touching the
 * database: an admin-gated one answers "admin required" (or null for a
 * read), a staff-gated one stops at requireStaff. `validatesFirst` names a
 * command that checks its input before choosing its gate; it needs a valid
 * call of its own.
 */
export function everyCommandIsGated(commands: Record<string, unknown>, validatesFirst: string[] = []) {
  const names = Object.entries(commands)
    .filter(([name, value]) => typeof value === "function" && !validatesFirst.includes(name))
    .map(([name]) => name);
  it.each(names)("%s refuses a caller below its gate, whatever the input", async (name) => {
    harness.admin = false;
    harness.staff = false;
    const call = commands[name] as (...args: unknown[]) => Promise<unknown>;
    let outcome: unknown;
    try {
      outcome = await call({}, {});
    } catch (error) {
      expect(String(error)).toMatch(/not staff/);
    }
    if (outcome !== undefined && outcome !== null) {
      expect(outcome).toMatchObject({ ok: false, error: "admin required" });
    }
    expect(untouched()).toBe(true);
  });
}
