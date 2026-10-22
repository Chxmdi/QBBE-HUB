import { describe, expect, it } from "vitest";
import { parseArgs, resetAdminMfa, RefusedError } from "../../scripts/ops/reset-admin-mfa.mjs";

const ORG = "org-1";
const people: Record<string, { id: string; role: string; org?: string }> = {
  "admin@qbbe.org": { id: "u-admin", role: "admin" },
  "owner@qbbe.org": { id: "u-owner", role: "owner" },
  "admin2@qbbe.org": { id: "u-admin2", role: "admin" },
  "staff@qbbe.org": { id: "u-staff", role: "staff" },
  "other@else.org": { id: "u-other", role: "admin", org: "org-2" },
};

/** Profiles, memberships, audit rows and the Auth admin MFA calls. */
function fakeDb({ auditFails = false } = {}) {
  const audit: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      ilike: (_c: string, v: string) => ((filters.email = v.replace(/\\/g, "").toLowerCase()), q),
      eq: (c: string, v: unknown) => ((filters[c] = v), q),
      in: () => q,
      maybeSingle: async () => {
        if (table === "user_profile") {
          const p = people[filters.email as string];
          return { data: p ? { id: p.id, email: filters.email } : null, error: null };
        }
        const entry = Object.values(people).find((p) => p.id === filters.user_id);
        return {
          data: entry && ["owner", "admin"].includes(entry.role) ? { organization_id: entry.org ?? ORG, role: entry.role, status: "active" } : null,
          error: null,
        };
      },
      insert: async (row: Record<string, unknown>) => {
        if (auditFails) return { error: { message: "denied" } };
        audit.push(row);
        return { error: null };
      },
    };
    return q;
  };
  const db = {
    from: query,
    auth: {
      admin: {
        mfa: {
          listFactors: async () => ({ data: { factors: [{ id: "f1" }, { id: "f2" }] }, error: null }),
          deleteFactor: async ({ id }: { id: string }) => (deleted.push(id), { error: null }),
        },
      },
    },
  };
  return { db, audit, deleted };
}

const args = (extra: string[] = []) =>
  parseArgs(["--email", "admin@qbbe.org", "--approved-by", "owner@qbbe.org", "--approved-by", "admin2@qbbe.org", "--reason", "lost phone, identity checked", ...extra]);

describe("break-glass MFA reset", () => {
  it("removes every factor and writes one audit row naming both approvers", async () => {
    const { db, audit, deleted } = fakeDb();
    const result = await resetAdminMfa(db, args());
    expect(result).toMatchObject({ removed: 2 });
    expect(deleted).toEqual(["f1", "f2"]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "mfa.break_glass_reset", object_id: "u-admin", actor_id: "u-owner" });
    expect((audit[0].metadata as { approvers: string[] }).approvers).toEqual(["u-owner", "u-admin2"]);
  });

  it("refuses without two different approvers, or with the target approving", () => {
    expect(() => parseArgs(["--email", "admin@qbbe.org", "--approved-by", "owner@qbbe.org", "--approved-by", "OWNER@qbbe.org", "--reason", "lost phone, identity checked"])).toThrow(RefusedError);
    expect(() => parseArgs(["--email", "admin@qbbe.org", "--approved-by", "owner@qbbe.org", "--approved-by", "admin@qbbe.org", "--reason", "lost phone, identity checked"])).toThrow(/cannot approve/);
    expect(() => parseArgs(["--email", "admin@qbbe.org", "--approved-by", "a@x", "--approved-by", "b@x"])).toThrow(/reason/);
  });

  it("refuses a target who is not an owner or admin, and approvers from elsewhere", async () => {
    const { db, deleted } = fakeDb();
    await expect(resetAdminMfa(db, { ...args(), email: "staff@qbbe.org" })).rejects.toThrow(/only for them/);
    await expect(resetAdminMfa(db, { ...args(), approvers: ["owner@qbbe.org", "other@else.org"] })).rejects.toThrow(/same organization/);
    await expect(resetAdminMfa(db, { ...args(), approvers: ["owner@qbbe.org", "staff@qbbe.org"] })).rejects.toThrow(/not an active owner/);
    expect(deleted).toEqual([]);
  });

  it("removes nothing when the audit record cannot be written, or on a dry run", async () => {
    const failing = fakeDb({ auditFails: true });
    await expect(resetAdminMfa(failing.db, args())).rejects.toThrow(/Stopped before removing anything/);
    expect(failing.deleted).toEqual([]);
    const dry = fakeDb();
    expect(await resetAdminMfa(dry.db, args(["--dry-run"]))).toMatchObject({ factors: 2, removed: 0, dryRun: true });
    expect(dry.deleted).toEqual([]);
    expect(dry.audit).toEqual([]);
  });
});
