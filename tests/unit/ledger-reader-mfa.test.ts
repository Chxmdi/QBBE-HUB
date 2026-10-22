import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-025: staff named as ledger readers read payroll and gifts only after
 * MFA. A reader whose session has no second factor yet is sent to set it up
 * instead of seeing an empty ledger; other staff still see "no access".
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ME = "33333333-3333-4333-8333-333333333333";

let session = { userId: ME, organizationId: ORG, isAdmin: false, isStaff: true };
let tables: Record<string, unknown[]> = {};

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => session,
  NO_ACCESS_REDIRECT: "/",
}));
vi.mock("@/lib/supabase/page", () => ({
  createSupabasePageClient: async () => ({
    from: (table: string) => {
      const rows = tables[table] ?? [];
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        lte: () => q,
        gt: () => q,
        limit: async () => ({ data: rows, error: null }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return q;
    },
    rpc: async () => ({ error: null }),
  }),
}));

const { getLedgerAccess } = await import("@/features/ledger/services/ledger.access");

async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { to?: string }).to ?? null;
  }
}

describe("getLedgerAccess for ledger readers", () => {
  beforeEach(() => {
    session = { userId: ME, organizationId: ORG, isAdmin: false, isStaff: true };
    tables = {};
  });

  it("sends a ledger reader without MFA to complete it", async () => {
    tables = { ledger_reader: [{ user_id: ME }] };
    expect(await redirectOf(getLedgerAccess)).toBe("/mfa?next=/finance/ledger");
  });

  it("opens the books to a ledger reader with MFA", async () => {
    tables = { ledger_reader: [{ user_id: ME }], ledger_settings: [{ chart_approved_on: null }] };
    const access = await getLedgerAccess();
    expect(access.canRead).toBe(true);
    expect(access.canManage).toBe(false);
  });

  it("leaves other staff on the no-access screen", async () => {
    const access = await getLedgerAccess();
    expect(access.canRead).toBe(false);
  });
});
