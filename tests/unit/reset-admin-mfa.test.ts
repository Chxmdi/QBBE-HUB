import { describe, expect, it } from "vitest";
import { parseArgs, resetAdminMfa, RefusedError } from "../../scripts/ops/reset-admin-mfa.mjs";

const ORG = "org-1";
// Sign-in accounts (Auth), by id.
const users = [
  { id: "u-admin", email: "admin@qbbe.org" },
  { id: "u-owner", email: "Owner@qbbe.org" },
  { id: "u-admin2", email: "admin2@qbbe.org" },
  { id: "u-staff", email: "staff@qbbe.org" },
  { id: "u-other", email: "other@else.org" },
];
const memberships = [
  { user_id: "u-admin", organization_id: ORG, role: "admin", status: "active" },
  { user_id: "u-owner", organization_id: ORG, role: "owner", status: "active" },
  { user_id: "u-admin2", organization_id: ORG, role: "admin", status: "active" },
  { user_id: "u-staff", organization_id: ORG, role: "staff", status: "active" },
  { user_id: "u-other", organization_id: "org-2", role: "admin", status: "active" },
];

function fakeDb({ auditFails = false, deleteFailsAt = -1 } = {}) {
  const audit: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const from = () => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filters[c] = v), q),
      in: (c: string, v: unknown[]) => ((filters[c] = v), q),
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: memberships.filter(
            (m) => m.user_id === filters.user_id && m.status === filters.status && (filters.role as string[]).includes(m.role),
          ),
          error: null,
        }),
      insert: async (row: Record<string, unknown>) => {
        if (auditFails) return { error: { message: "denied" } };
        audit.push(row);
        return { error: null };
      },
    };
    return q;
  };
  const db = {
    from,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users }, error: null }),
        mfa: {
          listFactors: async () => ({ data: { factors: [{ id: "f1" }, { id: "f2" }] }, error: null }),
          deleteFactor: async ({ id }: { id: string }) => {
            if (deleted.length === deleteFailsAt) return { error: { message: "boom" } };
            deleted.push(id);
            return { error: null };
          },
        },
      },
    },
  };
  return { db, audit, deleted };
}

const base = ["--operator", "op@qbbe.org", "--reason", "lost phone, identity checked"];
const args = (email = "admin@qbbe.org", approvers = ["owner@qbbe.org", "admin2@qbbe.org"], extra: string[] = []) =>
  parseArgs(["--email", email, ...approvers.flatMap((a) => ["--approved-by", a]), ...base, ...extra]);

describe("break-glass MFA reset", () => {
  it("removes every factor and records a started and a success row naming operator and approvers", async () => {
    const { db, audit, deleted } = fakeDb();
    expect(await resetAdminMfa(db, args())).toMatchObject({ removed: 2 });
    expect(deleted).toEqual(["f1", "f2"]);
    expect(audit.map((r) => r.result)).toEqual(["started", "success"]);
    expect(audit[1]).toMatchObject({ action: "mfa.break_glass_reset", object_id: "u-admin", actor_type: "operator" });
    expect(audit[1].metadata).toMatchObject({ operator: "op@qbbe.org", approvers: ["u-owner", "u-admin2"], removed: 2 });
  });

  it("refuses wildcards and anything but a plain address", () => {
    for (const bad of ["qa-owner@example.co*", "qa-adm*", "a%b@x.org", "a,b@x.org", "a b@x.org"]) {
      expect(() => args("admin@qbbe.org", ["owner@qbbe.org", bad])).toThrow(RefusedError);
    }
    expect(() => args("adm*@qbbe.org")).toThrow(/plain/);
    expect(() => parseArgs(["--email", "admin@qbbe.org", "--approved-by"])).toThrow(/needs an address/);
    expect(() => parseArgs(["--email", "admin@qbbe.org", "--approved-by", "--dry-run"])).toThrow(/needs an address/);
  });

  it("counts approvers by account: one person under two spellings, or the target, is refused", async () => {
    const { db, deleted } = fakeDb();
    await expect(resetAdminMfa(db, args("admin@qbbe.org", ["owner@qbbe.org", "OWNER@qbbe.org"]))).rejects.toThrow(/two different people/);
    await expect(resetAdminMfa(db, args("admin@qbbe.org", ["owner@qbbe.org", "admin@qbbe.org"]))).rejects.toThrow(/own reset/);
    expect(deleted).toEqual([]);
  });

  it("refuses a target who is not an owner or admin, and approvers from elsewhere or without the role", async () => {
    const { db, deleted } = fakeDb();
    await expect(resetAdminMfa(db, args("staff@qbbe.org"))).rejects.toThrow(/only for them/);
    await expect(resetAdminMfa(db, args("admin@qbbe.org", ["owner@qbbe.org", "other@else.org"]))).rejects.toThrow(/same organization/);
    await expect(resetAdminMfa(db, args("admin@qbbe.org", ["owner@qbbe.org", "staff@qbbe.org"]))).rejects.toThrow(/same organization/);
    await expect(resetAdminMfa(db, args("nobody@qbbe.org"))).rejects.toThrow(/No sign-in account/);
    expect(deleted).toEqual([]);
  });

  it("removes nothing without an audit record or on a dry run, and records a partial failure", async () => {
    const failing = fakeDb({ auditFails: true });
    await expect(resetAdminMfa(failing.db, args())).rejects.toThrow(/Stopped before removing anything/);
    expect(failing.deleted).toEqual([]);

    const dry = fakeDb();
    expect(await resetAdminMfa(dry.db, args(undefined, undefined, ["--dry-run"]))).toMatchObject({ factors: 2, removed: 0 });
    expect(dry.deleted).toEqual([]);
    expect(dry.audit).toEqual([]);

    const partial = fakeDb({ deleteFailsAt: 1 });
    await expect(resetAdminMfa(partial.db, args())).rejects.toThrow(/Removed 1 of 2/);
    expect(partial.audit.map((r) => r.result)).toEqual(["started", "failed"]);
  });

  it("requires an operator, a reason and exactly two approvers", () => {
    expect(() => parseArgs(["--email", "admin@qbbe.org", "--approved-by", "owner@qbbe.org", "--approved-by", "admin2@qbbe.org", "--reason", "lost phone, checked"])).toThrow(/--operator/);
    expect(() => args("admin@qbbe.org", ["owner@qbbe.org"])).toThrow(/Exactly two/);
  });
});
