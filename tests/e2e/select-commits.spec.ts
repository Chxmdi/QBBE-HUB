import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * A select that wrote data the moment its value changed. Arrow keys on a
 * closed select change its value in Chrome and Edge, so each keypress
 * committed, and a quick second choice ran the action twice. Creating a
 * project from a template expands a whole project with its tasks, so it now
 * waits for an explicit Create button and cannot run twice at once.
 *
 * Member role changes are left as they are until the owner decides which
 * changes need a confirmation.
 */

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test("choosing a template creates nothing until Create, and Create runs once", async ({ page }) => {
  test.setTimeout(90_000);
  const org = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1;`)
    .split("\n")[0];
  const name = `Select commit ${randomUUID().slice(0, 8)}`;
  sql(`
    insert into project_template (organization_id, name, created_by, approved_at, approved_by)
    values ('${org}', '${name}', '${OWNER_ID}', now(), '${OWNER_ID}');
  `);
  const projects = () => Number(sql(`select count(*) from project where name like '${name}%';`));

  await signIn(page, "owner");
  await page.goto("/projects");
  const select = page.getByLabel("Create from template", { exact: true });
  await expect(select).toBeVisible();

  // Moving through the list writes nothing.
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await select.selectOption({ label: name });
  await page.waitForTimeout(1_500);
  expect(projects(), "no project before Create").toBe(0);

  // A double click on Create makes one project.
  const create = page.getByRole("button", { name: "Create project from template", exact: true });
  await create.dblclick();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  expect(projects(), "exactly one project").toBe(1);
});
