import { beforeEach, describe, expect, it, vi } from "vitest";

// The administrator gate everything else mocks: who reaches an owner/admin
// Server Action, and what a password-only (aal1) administrator is told.

type Result<T> = { data: T; error: { message: string } | null };

const state: {
  user: { id: string; email?: string } | null;
  membership: Result<Record<string, unknown> | null>;
  actorId: string | null;
  assurance: Result<{ currentLevel: string | null; nextLevel: string | null } | null>;
  factors: Result<{ all: { id: string; factor_type: string; status: string; friendly_name?: string }[] } | null>;
} = {
  user: null,
  membership: { data: null, error: null },
  actorId: null,
  assurance: { data: null, error: null },
  factors: { data: null, error: null },
};

const ME = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const VERIFIED = { id: "f1", factor_type: "totp", status: "verified", friendly_name: "Phone" };

class Redirect extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const membershipQuery = {
      select: () => membershipQuery,
      eq: () => membershipQuery,
      order: () => membershipQuery,
      limit: () => membershipQuery,
      maybeSingle: async () => state.membership,
    };
    return {
      auth: {
        getUser: async () => ({ data: { user: state.user } }),
        mfa: {
          getAuthenticatorAssuranceLevel: async () => state.assurance,
          listFactors: async () => state.factors,
        },
      },
      from: () => membershipQuery,
      rpc: async () => ({ data: state.actorId, error: null }),
    };
  },
}));

const auth = await import("./auth");

function member(role: string) {
  state.user = { id: ME, email: "me@example.org" };
  state.membership = {
    data: {
      organization_id: ORG,
      role,
      status: "active",
      user_profile: { id: ME, full_name: "Me" },
      organization: { timezone: "America/Toronto" },
    },
    error: null,
  };
}

function mfa(currentLevel: string | null, nextLevel: string | null, factors = [VERIFIED]) {
  state.assurance = { data: { currentLevel, nextLevel }, error: null };
  state.factors = { data: { all: factors }, error: null };
}

beforeEach(() => {
  state.user = null;
  state.membership = { data: null, error: null };
  state.actorId = null;
  mfa("aal2", "aal2");
});

describe("getSessionContext", () => {
  it("is null when nobody is signed in", async () => {
    expect(await auth.getSessionContext()).toBeNull();
  });

  it("gives the role and what it allows", async () => {
    member("staff");
    expect(await auth.getSessionContext()).toMatchObject({
      userId: ME,
      organizationId: ORG,
      role: "staff",
      isStaff: true,
      isAdmin: false,
      timeZone: "America/Toronto",
    });
    member("admin");
    expect(await auth.getSessionContext()).toMatchObject({ isStaff: true, isAdmin: true });
    member("volunteer");
    expect(await auth.getSessionContext()).toMatchObject({ isStaff: false, isAdmin: false });
  });

  it("fails loudly when the membership cannot be read, rather than calling the person inactive", async () => {
    member("owner");
    state.membership = { data: null, error: { message: "timeout" } };
    await expect(auth.getSessionContext()).rejects.toThrow(/Could not read membership/);
  });

  it("tells a request that never reached the database apart from an inactive membership", async () => {
    state.user = { id: ME };
    await expect(auth.getSessionContext()).rejects.toBeInstanceOf(auth.SessionNotEstablishedError);
    state.actorId = ME;
    expect(await auth.getSessionContext()).toBeNull();
  });
});

describe("requireSession", () => {
  it("sends the signed-out to sign-in and the inactive to their own page", async () => {
    await expect(auth.requireSession()).rejects.toMatchObject({ to: "/sign-in" });
    state.user = { id: ME };
    state.actorId = ME;
    await expect(auth.requireSession()).rejects.toMatchObject({ to: "/account-inactive" });
  });
});

describe("authorizeAdminAction", () => {
  it("refuses everyone below administrator, whatever their factors", async () => {
    for (const role of ["staff", "volunteer", "guest"]) {
      member(role);
      expect(await auth.authorizeAdminAction()).toEqual({
        ok: false,
        error: "account.errors.adminRequired",
        reason: "role",
      });
    }
  });

  it("refuses an administrator an owner-only action", async () => {
    member("admin");
    expect(await auth.authorizeAdminAction({ ownerOnly: true })).toMatchObject({
      ok: false,
      error: "account.errors.ownerRequired",
      reason: "role",
    });
    member("owner");
    expect(await auth.authorizeAdminAction({ ownerOnly: true })).toMatchObject({ ok: true });
  });

  it("refuses an administrator signed in with a password only", async () => {
    member("admin");
    mfa("aal1", "aal2");
    expect(await auth.authorizeAdminAction()).toMatchObject({ ok: false, reason: "mfa" });
    mfa("aal1", "aal1", []);
    expect(await auth.authorizeAdminAction()).toMatchObject({ ok: false, reason: "mfa" });
  });

  it("refuses a stale second-factor session whose last factor was removed", async () => {
    member("owner");
    mfa("aal2", "aal1");
    expect(await auth.authorizeAdminAction()).toMatchObject({ ok: false, reason: "mfa" });
    mfa("aal2", "aal2", []);
    expect(await auth.authorizeAdminAction()).toMatchObject({ ok: false, reason: "mfa" });
    mfa("aal2", "aal2", [{ ...VERIFIED, status: "unverified" }]);
    expect(await auth.authorizeAdminAction()).toMatchObject({ ok: false, reason: "mfa" });
  });

  it("fails closed when the factors cannot be read", async () => {
    member("owner");
    state.factors = { data: null, error: { message: "down" } };
    expect(await auth.authorizeAdminAction()).toEqual({
      ok: false,
      error: "account.errors.mfaUnavailable",
      reason: "unavailable",
    });
    mfa("aal2", "aal2");
    state.assurance = { data: null, error: { message: "down" } };
    expect(await auth.authorizeAdminAction()).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("lets an administrator with a verified second factor through", async () => {
    member("admin");
    const result = await auth.authorizeAdminAction();
    expect(result).toMatchObject({ ok: true, session: { role: "admin", isAdmin: true } });
  });
});

describe("route gates", () => {
  it("send a non-administrator home and a password-only administrator to the second-factor step", async () => {
    member("staff");
    await expect(auth.requireAdminAal2()).rejects.toMatchObject({ to: auth.NO_ACCESS_REDIRECT });
    await expect(auth.requireAdmin()).rejects.toMatchObject({ to: auth.NO_ACCESS_REDIRECT });
    member("volunteer");
    await expect(auth.requireStaff()).rejects.toMatchObject({ to: auth.NO_ACCESS_REDIRECT });
    member("admin");
    mfa("aal1", "aal2");
    await expect(auth.requireAdminAal2()).rejects.toMatchObject({ to: "/mfa" });
    mfa("aal2", "aal2");
    expect(await auth.requireAdminAal2()).toMatchObject({ role: "admin" });
  });
});
