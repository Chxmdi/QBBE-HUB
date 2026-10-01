import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Private API (Workspace OS V2-8), behind wos_workflows_v2: a staff member
 * makes a token on the screen, calls /api/v1 with it as themselves, and
 * revokes it. Who may read, make and revoke tokens is proven in
 * supabase/tests/api-tokens.sql.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

function setSwitch(on: boolean) {
  sql(`update feature_flag set enabled = ${on} where key = 'wos_workflows_v2' and organization_id is null`);
}

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, `axe on ${label}`).toEqual([]);
}

test.afterAll(() => setSwitch(false));

test("a token calls the API as its owner, with their permissions, until revoked", async ({ page }) => {
  test.setTimeout(180_000);
  setSwitch(true);
  const name = `E2E tool ${Date.now()}`;
  const staff = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const org = sql(`select organization_id::text from organization_membership where user_id = '${staff}' limit 1`);
  const owner = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const program = sql(`insert into program (organization_id, name, slug, created_by)
    values ('${org}', 'E2E API', 'e2e-api-${Date.now()}', '${owner}') returning id::text`);
  const project = sql(`insert into project (organization_id, program_id, name, owner_id, created_by)
    values ('${org}', '${program}', 'E2E API', '${staff}', '${owner}') returning id::text`);
  const task = sql(`insert into task (organization_id, project_id, title, created_by, priority)
    values ('${org}', '${project}', 'E2E API task', '${owner}', 'low') returning id::text`);
  const type = sql(`select id::text from object_type where organization_id = '${org}' and key = 'task'`);
  sql(`insert into object (id, organization_id, type_id, title) values ('${task}', '${org}', '${type}', 'E2E API task')
    on conflict (id) do nothing`);

  try {
    await signIn(page, "staff");
    await page.goto("/api-tokens");
    await expect(page.getByRole("heading", { name: "API access tokens", level: 1 })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("checkbox", { name: /actions:run/ }).check();
    await page.getByRole("button", { name: "Make token" }).click();
    const tokenField = page.getByLabel("Your new token");
    await expect(tokenField).toHaveValue(/^qbbe_/);
    const token = await tokenField.inputValue();
    await axe(page, "/api-tokens");

    const api = page.request;
    const auth = { authorization: `Bearer ${token}` };

    // Who, and what it may do.
    const me = await api.get("/api/v1/me", { headers: auth });
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ data: { userId: staff, organizationId: org, scopes: ["objects:read", "actions:run"] } });

    // No token, or a wrong one: refused.
    expect((await api.get("/api/v1/me", { maxRedirects: 0 })).status()).toBe(401);
    expect((await api.get("/api/v1/me", { headers: { authorization: `Bearer qbbe_${"x".repeat(43)}` } })).status()).toBe(401);

    // Objects, as the staff member (they lead the task's project).
    const list = await api.get("/api/v1/objects?type=task&limit=100", { headers: auth });
    expect(list.status()).toBe(200);
    expect((await list.json()).data.map((object: { id: string }) => object.id)).toContain(task);
    const one = await api.get(`/api/v1/objects/${task}/properties`, { headers: auth });
    expect(await one.json()).toMatchObject({ data: { object: { id: task, type: "task" }, properties: { priority: "low" } } });
    const relations = await api.get(`/api/v1/objects/${task}/relations`, { headers: auth });
    expect((await relations.json()).data.relations).toContainEqual({ type: "contains", direction: "incoming", object: { id: project, type: "project" } });
    expect((await api.get(`/api/v1/objects/${crypto.randomUUID()}`, { headers: auth })).status()).toBe(404);

    // An action, checked as the staff member, labelled as the integration.
    const run = await api.post("/api/v1/actions/task.set_priority", { headers: auth, data: { input: { taskId: task, priority: "high" } } });
    expect(run.status()).toBe(200);
    expect(sql(`select priority::text from task where id = '${task}'`)).toBe("high");
    expect((await api.post("/api/v1/actions/task.set_priority", { headers: auth, data: { nope: 1 } })).status()).toBe(400);

    // Every call is on record.
    expect(Number(sql(`select count(*) from api_request_log l join api_token t on t.id = l.token_id where t.name = '${name}'`)))
      .toBeGreaterThanOrEqual(7);

    // Revoked: refused at once.
    await page.reload();
    await page.getByRole("button", { name: `Revoke ${name}` }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Revoked");
    expect((await api.get("/api/v1/me", { headers: auth })).status()).toBe(401);

    // The docs, in both languages.
    await page.getByRole("link", { name: "Read the API documentation" }).click();
    await expect(page.getByRole("heading", { name: "Private API", level: 1 })).toBeVisible();
    await expect(page.getByRole("table", { name: "Endpoints" })).toContainText("/api/v1/actions/{key}");
    await axe(page, "/api-tokens/docs");
    const origin = new URL(page.url()).origin;
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "API privée", level: 1 })).toBeVisible();
    await expect(page.getByRole("table", { name: "Points d’accès" })).toBeVisible();
    await axe(page, "/api-tokens/docs (fr-CA)");
  } finally {
    await page.context().clearCookies({ name: "qbbe-locale" });
    sql(`delete from api_token where name = '${name}'`);
    sql(`delete from object where id = '${task}'`);
    sql(`delete from task where id = '${task}'`);
    sql(`delete from project where id = '${project}'`);
    sql(`delete from program where id = '${program}'`);
  }
});

/** A read-only token for the staff member; returns its bearer value and the hash to delete it by. */
function readOnlyToken(): { token: string; hash: string } {
  const staff = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const org = sql(`select organization_id::text from organization_membership where user_id = '${staff}' limit 1`);
  const token = `qbbe_${"r".repeat(43)}`;
  const hash = sql(`select encode(extensions.digest('${token}', 'sha256'), 'hex')`);
  sql(`insert into api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
    values ('${org}', '${staff}', 'E2E read only', '${hash}', 'qbbe_rrrrrrr', array['objects:read'], now() + interval '1 day')`);
  return { token, hash };
}

test("a token without the actions scope cannot run actions", async ({ page }) => {
  setSwitch(true);
  const { token, hash } = readOnlyToken();
  try {
    const auth = { authorization: `Bearer ${token}` };
    const refused = await page.request.post("/api/v1/actions/task.set_priority", { headers: auth, data: { input: {} } });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "insufficient_scope" } });
    expect((await page.request.get("/api/v1/actions", { headers: auth })).status()).toBe(403);
  } finally {
    sql(`delete from api_token where token_hash = '${hash}'`);
  }
});

test("the API is off with the switch [switch off]", async ({ page }) => {
  setSwitch(false);
  const { token, hash } = readOnlyToken();
  try {
    const auth = { authorization: `Bearer ${token}` };
    expect((await page.request.get("/api/v1/me", { headers: auth })).status()).toBe(404);
  } finally {
    sql(`delete from api_token where token_hash = '${hash}'`);
  }
});
