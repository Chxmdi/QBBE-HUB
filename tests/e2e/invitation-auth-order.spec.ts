import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "./fixtures";
import { sql } from "./db";

/**
 * SEC-001 against the real Supabase Auth server rather than hand-written
 * inserts. Auth does not write a new user in one statement: it inserts the
 * row, then adds app_metadata, then confirms the address with a separate
 * UPDATE, and writes user metadata back from its in-memory copy. The SQL tests
 * write each user in its final state, which once hid that Google sign-in and
 * operator provisioning were both refused. These go through the Auth API
 * itself: the admin API an operator uses, the public sign-up a person uses,
 * and an unconfirmed sign-up confirmed through its real confirmation link.
 */

const PASSWORD = "QaTest!2026";
const API = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const secret = () => randomBytes(32).toString("base64url");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}@example.com`;

/** An open volunteer invitation from the workspace owner; returns its id. */
function invite(email: string, token: string | null): string {
  return sql(
    `insert into invitation (organization_id, email, intended_role, invited_by, expires_at, token_hash)
     select organization_id, '${email}', 'volunteer', user_id, now() + interval '14 days',
            ${token ? `'${sha256(token)}'` : "null"}
     from organization_membership where role = 'owner' and status = 'active'
     order by joined_at limit 1
     returning id;`,
  );
}

function membership(email: string): string {
  return sql(
    `select coalesce(string_agg(m.status::text, ','), 'none')
     from organization_membership m join auth.users u on u.id = m.user_id
     where u.email = '${email}';`,
  );
}

/** "true"/"false" for whether the stored user still holds the secret; "" if there is no user. */
function storedToken(email: string): string {
  return sql(`select (raw_user_meta_data ? 'invite_token')::text from auth.users where email = '${email}';`);
}

function adminCall(path: string, body: unknown) {
  return fetch(`${API}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function claimsOf(accessToken: string): { user_metadata?: Record<string, unknown> } {
  return JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
}

test.describe("invitations through the real Auth server (SEC-001)", () => {
  test.beforeAll(() => {
    expect(API && ANON && SERVICE, "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required").toBeTruthy();
  });

  test("an operator provisions an invited person through the Auth admin API with the link's secret", async () => {
    const email = uniqueEmail("auth-order-operator");
    const token = secret();
    invite(email, token);

    const res = await adminCall("admin/users", {
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Operator Provisioned", invite_token: token },
    });
    expect(res.status).toBe(200);
    expect(membership(email)).toBe("active");
    expect(storedToken(email)).toBe("false");
  });

  test("the admin API's app_metadata arrives after the insert, so it is not proof on its own", async () => {
    const email = uniqueEmail("auth-order-marker");
    invite(email, null);

    const res = await adminCall("admin/users", {
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { provisioned_by_operator: true },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(storedToken(email)).toBe("");
  });

  test("a person who signs up with the link is admitted, and the secret does not stay on the account", async () => {
    const email = uniqueEmail("auth-order-person");
    const token = secret();
    invite(email, token);

    const res = await fetch(`${API}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, data: { full_name: "Signed Up", invite_token: token } }),
    });
    expect(res.status).toBe(200);
    const session = await res.json();
    expect(membership(email)).toBe("active");
    // Auth writes user metadata back after confirming; the trigger strips it again.
    expect(storedToken(email)).toBe("false");

    // The session issued by the sign-up itself is built from Auth's in-memory
    // copy; the next one is read from the stored user and no longer has it.
    const refreshed = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }).then((r) => r.json());
    expect(claimsOf(refreshed.access_token).user_metadata ?? {}).not.toHaveProperty("invite_token");
  });

  test("without the link, a password sign-up is refused and leaves no account", async () => {
    const email = uniqueEmail("auth-order-nolink");
    invite(email, null);

    const res = await fetch(`${API}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(storedToken(email)).toBe("");
  });

  test("a New link issued between sign-up and confirmation does not strand the person", async () => {
    const email = uniqueEmail("auth-order-pending");
    const token = secret();
    const invitationId = invite(email, token);

    // generate_link creates the user unconfirmed and returns the confirmation
    // link Auth would have emailed.
    const res = await adminCall("admin/generate_link", {
      type: "signup",
      email,
      password: PASSWORD,
      data: { full_name: "Pending Person", invite_token: token },
    });
    expect(res.status).toBe(200);
    const { action_link: confirmationLink } = await res.json();
    expect(sql(`select email_confirmed_at is null from auth.users where email = '${email}';`)).toBe("t");
    expect(membership(email)).toBe("none");
    expect(storedToken(email)).toBe("false");

    // What "New link" does (reissueInvitation): the old secret stops working.
    sql(
      `update invitation set token_hash = '${sha256(secret())}', expires_at = now() + interval '14 days'
       where id = '${invitationId}';`,
    );

    const confirmed = await fetch(confirmationLink, { redirect: "manual" });
    expect([302, 303]).toContain(confirmed.status);
    expect(membership(email)).toBe("active");
  });

  test("an invitation revoked before confirmation grants nothing, and the confirmation still goes through", async () => {
    const email = uniqueEmail("auth-order-revoked");
    const token = secret();
    const invitationId = invite(email, token);

    const res = await adminCall("admin/generate_link", {
      type: "signup",
      email,
      password: PASSWORD,
      data: { invite_token: token },
    });
    const { action_link: confirmationLink } = await res.json();
    sql(`update invitation set revoked_at = now() where id = '${invitationId}';`);

    const confirmed = await fetch(confirmationLink, { redirect: "manual" });
    expect([302, 303]).toContain(confirmed.status);
    expect(sql(`select email_confirmed_at is not null from auth.users where email = '${email}';`)).toBe("t");
    expect(membership(email)).toBe("none");
  });
});
