import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { parseCsv } from "../../src/features/lenses/csv/parse";

/**
 * Workspace OS U15: CSV export of any lens, and CSV import with column
 * mapping, behind the wos_lenses switch (and wos_objects for undo). Both
 * switches are turned on for this file only and restored afterwards.
 */

const RUN = `CsvE2E ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const previous: Record<string, string> = {};

test.beforeAll(() => {
  for (const key of ["wos_lenses", "wos_objects"]) {
    previous[key] = sql(`select coalesce((select enabled from public.feature_flag where key = '${key}'), false)`);
    sql(`update public.feature_flag set enabled = true where key = '${key}'`);
  }
  // Two tasks for staff, one for the volunteer, one for the owner alone.
  sql(`
    insert into public.task (organization_id, title, created_by, requester_id, assignee_id, status, priority)
    select m.organization_id, v.title, m.user_id, m.user_id, v.assignee::uuid, 'ready', 'medium'
    from public.organization_membership m
    cross join (values
      ('${RUN} staff one', '${STAFF}'),
      ('${RUN} staff two', '${STAFF}'),
      ('${RUN} volunteer', '${VOLUNTEER}'),
      ('${RUN} owner only', '${OWNER}')
    ) as v(title, assignee)
    where m.user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.task where title like '${RUN}%'`);
  for (const [key, value] of Object.entries(previous)) {
    sql(`update public.feature_flag set enabled = ${value === "t" ? "true" : "false"} where key = '${key}'`);
  }
});

/** How many of this run's tasks the person can see, asked of the database under their own RLS. */
function visibleTo(userId: string): number {
  const out = sql(`
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated","aal":"aal1"}';
    select count(*) from public.task where title like '${RUN}%' and archived_at is null;
    rollback;
  `);
  return Number(out.split("\n").filter(Boolean).pop());
}

const spec = { version: 1, type: "task", where: { and: [{ property: "title", operator: "contains", value: RUN }] }, select: ["status", "assignee", "due"] };

async function exportAs(page: Page) {
  const response = await page.request.post("/api/lenses/export", { data: { spec } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const text = await response.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  return parseCsv(text);
}

test("a lens exports exactly what the viewer can see [switches on]", async ({ page }) => {
  const staffSees = visibleTo(STAFF);
  const volunteerSees = visibleTo(VOLUNTEER);
  expect(staffSees).toBe(2);
  expect(volunteerSees).toBe(1);

  await signIn(page, "staff");
  // Counted the same way before and after: earlier runs on this database
  // (other browsers, the table button below) left exports of other sizes.
  const exportsOfThisSize = () =>
    Number(sql(`select count(*) from public.audit_event where action = 'lens_exported' and actor_id = '${STAFF}' and event_type = 'data_export' and (metadata->>'rows')::int = ${staffSees}`));
  const before = exportsOfThisSize();
  const staff = await exportAs(page);
  expect(staff.headers).toEqual(["Title", "Status", "Assignee", "Due"]);
  expect(staff.rows).toHaveLength(staffSees);
  expect(staff.rows.map((r) => r[0]).sort()).toEqual([`${RUN} staff one`, `${RUN} staff two`]);
  expect(staff.rows.every((r) => r[1] === "Ready" && r[2] !== "")).toBe(true);
  await expect.poll(exportsOfThisSize).toBe(before + 1);

  // The button on the table lens downloads the same rows.
  await page.goto(`/lenses/table?type=task`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tasks-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect(page.getByRole("status").filter({ hasText: /rows? exported/ })).toBeAttached();

  // A cross-site request is refused before anything runs.
  const cross = await page.request.post("/api/lenses/export", { data: { spec }, headers: { Origin: "https://evil.example" } });
  expect(cross.status()).toBe(403);

  await page.context().clearCookies();
  await signIn(page, "volunteer");
  const volunteer = await exportAs(page);
  expect(volunteer.rows).toHaveLength(volunteerSees);
  expect(volunteer.rows[0][0]).toBe(`${RUN} volunteer`);
});

async function upload(page: Page, name: string, csv: string) {
  await page.goto("/lenses/import");
  await expect(page.getByRole("heading", { name: "Import from CSV" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("CSV file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(`﻿${csv}`, "utf8") });
  await page.getByRole("button", { name: "Read the file" }).click();
}

test("a CSV import creates mapped tasks in one change set and can be undone [switches on]", async ({ page }) => {
  await signIn(page, "owner");
  // French headers, a semicolon file and a Quebec date: what a French Excel writes.
  const csv = [
    "Titre;Échéance;Priorité;Assigned to;Notes",
    `${RUN} import one;04/03/2027;Haute;qa-staff@example.com;première`,
    `${RUN} import two;2027-03-05;low;;"deux; avec point-virgule"`,
    `${RUN} import three;;;;`,
  ].join("\r\n");
  await upload(page, "taches.csv", csv);

  // Suggestions: every column mapped by its header.
  await expect(page.getByRole("status").filter({ hasText: "3 rows found, 5 columns." })).toBeVisible();
  await expect(page.getByLabel("Property for the Titre column")).toHaveValue("title");
  await expect(page.getByLabel("Property for the Échéance column")).toHaveValue("due");
  await expect(page.getByLabel("Property for the Priorité column")).toHaveValue("priority");
  await expect(page.getByLabel("Property for the Assigned to column")).toHaveValue("assignee");
  await expect(page.getByLabel("Property for the Notes column")).toHaveValue("description");

  // Keyboard: skip the notes column, then go on.
  await page.getByLabel("Property for the Notes column").focus();
  await page.getByLabel("Property for the Notes column").selectOption("");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("import-summary")).toHaveText("Ready to import: 3. With a problem: 0.");
  await page.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(page.getByTestId("import-result")).toContainText("3 records created.", { timeout: 30_000 });

  const changeSet = sql(`
    select c.id from public.change_set c
    where c.action_key = 'object.import' and c.actor_id = '${OWNER}'
    order by c.created_at desc limit 1`);
  expect(changeSet).toMatch(/^[0-9a-f-]{36}$/);
  expect(sql(`select count(*) from public.change_set_item where change_set_id = '${changeSet}' and kind = 'create'`)).toBe("3");
  expect(sql(`select due_at || ' ' || priority || ' ' || coalesce(assignee_id::text, '-') || ' ' || coalesce(description, '-') from public.task where title = '${RUN} import one'`))
    .toBe(`2027-03-04 high ${STAFF} -`);
  expect(sql(`select count(*) from public.task t join public.change_set_item i on i.object_id = t.id where i.change_set_id = '${changeSet}' and t.title like '${RUN} import%'`)).toBe("3");

  await page.getByRole("button", { name: "Undo this import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The import was undone" })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select count(*) from public.task where title like '${RUN} import%' and archived_at is not null`)).toBe("3");
  expect(sql(`select count(*) from public.change_set where undo_of = '${changeSet}'`)).toBe("1");
});

test("a row with a bad date is reported and skipped [switches on]", async ({ page }) => {
  await signIn(page, "owner");
  const csv = [
    "Title,Due",
    `${RUN} dated good,2027-01-15`,
    `${RUN} dated bad,31/02/2027`,
    `${RUN} dated quebec,15/01/2027`,
  ].join("\n");
  await upload(page, "dates.csv", csv);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("import-summary")).toHaveText("Ready to import: 2. With a problem: 1.");
  const bad = page.locator('tr[data-row-status="problem"]');
  await expect(bad).toHaveCount(1);
  await expect(bad).toContainText("Due: “31/02/2027” is not a date. Use YYYY-MM-DD or DD/MM/YYYY.");

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByTestId("import-result")).toContainText("2 records created. 1 row skipped.", { timeout: 30_000 });
  await expect(page.getByText("Row 2: Due: “31/02/2027” is not a date.", { exact: false })).toBeVisible();
  expect(sql(`select count(*) from public.task where title = '${RUN} dated bad'`)).toBe("0");
  expect(sql(`select string_agg(due_at::text, ',' order by title) from public.task where title like '${RUN} dated%'`)).toBe("2027-01-15,2027-01-15");
});
