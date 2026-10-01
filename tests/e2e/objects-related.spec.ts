import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M3b: the Related panel on any object, reading every link to
 * and from it (task.project_id, task_dependency and stored links) in both
 * directions. Hidden until the `wos_objects` switch is on.
 */

function setObjectsSwitch(enabled: boolean): boolean {
  const before = sql(`select enabled from feature_flag where key = 'wos_objects' and organization_id is null`) === "t";
  sql(`update feature_flag set enabled = ${enabled} where key = 'wos_objects' and organization_id is null`);
  return before;
}

test("an object's page is hidden while the switch is off [switch off]", async ({ page }) => {
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`);
  const task = sql(
    `insert into task (organization_id, title, created_by)
     values ('${orgId}', 'Hidden object ${Date.now()}', '${ownerId}') returning id`,
  );
  const before = setObjectsSwitch(false);
  try {
    await signIn(page, "owner");
    // Switch off: the route does not exist.
    await page.goto(`/objects/${task}`);
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  } finally {
    setObjectsSwitch(before);
    sql(`delete from task where id = '${task}'`);
  }
});

test("the Related panel lists links both ways, is keyboard usable, accessible and bilingual", async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `Related ${Date.now()}`;
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`);
  const project = sql(
    `insert into project (organization_id, name, owner_id, created_by)
     values ('${orgId}', '${marker} project', '${ownerId}', '${ownerId}') returning id`,
  );
  const venue = sql(
    `insert into task (organization_id, project_id, title, created_by)
     values ('${orgId}', '${project}', '${marker} book venue', '${ownerId}') returning id`,
  );
  const invites = sql(
    `insert into task (organization_id, project_id, title, created_by)
     values ('${orgId}', '${project}', '${marker} send invites', '${ownerId}') returning id`,
  );
  sql(`insert into task_dependency (blocking_task_id, blocked_task_id) values ('${venue}', '${invites}')`);

  const before = setObjectsSwitch(true);
  try {
    await signIn(page, "owner");
    await page.goto(`/objects/${venue}`);
    await expect(page.getByRole("heading", { level: 1, name: `${marker} book venue` })).toBeVisible();
    const panel = page.getByRole("region", { name: "Related" });
    await expect(panel).toContainText("2 linked");
    await expect(panel.getByTestId("related-contains:incoming").getByRole("heading")).toContainText("Is in");
    await expect(panel.getByTestId("related-blocks:outgoing").getByRole("link", { name: `Open ${marker} send invites` })).toBeVisible();

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations, JSON.stringify(axe.violations, null, 1)).toEqual([]);

    // Keyboard: focus the project link and press Enter.
    await panel.getByRole("link", { name: `Open ${marker} project` }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/objects/${project}$`));
    const projectPanel = page.getByRole("region", { name: "Related" });
    const contains = projectPanel.getByTestId("related-contains:outgoing");
    await expect(contains.getByRole("heading")).toContainText("Contains");
    await expect(contains.getByRole("listitem")).toHaveCount(2);

    // The other direction of the dependency, from the blocked task.
    await page.goto(`/objects/${invites}`);
    await expect(
      page.getByTestId("related-blocks:incoming").getByRole("link", { name: `Open ${marker} book venue` }),
    ).toBeVisible();
    await expect(page.getByTestId("related-blocks:incoming").getByRole("heading")).toContainText("Is blocked by");

    // French.
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.reload();
    const frenchPanel = page.getByRole("region", { name: "Liés" });
    await expect(frenchPanel.getByTestId("related-blocks:incoming").getByRole("heading")).toContainText("Est bloqué par");
    const axeFr = await new AxeBuilder({ page }).analyze();
    expect(axeFr.violations, JSON.stringify(axeFr.violations, null, 1)).toEqual([]);

    // Something the viewer cannot see is not found, not described.
    await page.goto(`/objects/00000000-0000-0000-0000-000000000000`);
    await expect(page.getByRole("heading", { name: "Introuvable — ou non accessible pour vous" })).toBeVisible();
  } finally {
    setObjectsSwitch(before);
    sql(`delete from task where id in ('${venue}', '${invites}'); delete from project where id = '${project}'`);
  }
});
