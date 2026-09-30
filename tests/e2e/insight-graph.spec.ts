import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { expectAccessible, qaIds, setLensesSwitch } from "./insight";

/**
 * Graph lens (V2-1): objects and their links drawn around a chosen object,
 * with a list view carrying the same content for keyboard and screen-reader
 * use. Hidden until the lenses switch is on.
 */
test("the graph lens centres on a project, filters by depth and has a keyboard-usable list", async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `Graph ${Date.now()}`;
  const { ownerId, orgId } = qaIds();
  const project = sql(
    `insert into project (organization_id, name, owner_id, created_by)
     values ('${orgId}', '${marker} project', '${ownerId}', '${ownerId}') returning id`,
  );
  const milestone = sql(`insert into milestone (project_id, name) values ('${project}', '${marker} launch') returning id`);
  const venue = sql(
    `insert into task (organization_id, project_id, milestone_id, title, created_by)
     values ('${orgId}', '${project}', '${milestone}', '${marker} book venue', '${ownerId}') returning id`,
  );
  const invites = sql(
    `insert into task (organization_id, project_id, milestone_id, title, created_by)
     values ('${orgId}', '${project}', '${milestone}', '${marker} send invites', '${ownerId}') returning id`,
  );
  sql(`insert into task_dependency (blocking_task_id, blocked_task_id) values ('${venue}', '${invites}')`);

  const before = setLensesSwitch(false);
  try {
    await signIn(page, "owner");

    // Switch off: the route does not exist.
    await page.goto("/insight/graph");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Relationship graph" })).toHaveCount(0);

    setLensesSwitch(true);
    await page.goto(`/insight/graph?root=${project}&depth=1`);
    await expect(page.getByRole("heading", { name: "Relationship graph" })).toBeVisible();
    const picture = page.getByRole("group", { name: /^Graph of \d+ objects/ });
    await expect(picture).toBeVisible();
    // One step out from the project: the milestone, not the tasks inside it.
    await expect(picture.getByRole("link", { name: `Centre the graph on Milestone: ${marker} launch` })).toBeVisible();
    await expect(picture.getByRole("link", { name: new RegExp(`${marker} book venue`) })).toHaveCount(0);

    // Keyboard: Tab to the milestone node and press Enter to centre on it.
    const milestoneNode = picture.getByRole("link", { name: `Centre the graph on Milestone: ${marker} launch` });
    await milestoneNode.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`root=${milestone}`));
    await expect(
      page.getByRole("group", { name: /^Graph of/ }).getByRole("link", { name: `Centre the graph on Task: ${marker} book venue` }),
    ).toBeVisible();
    await expectAccessible(page);

    // The list view says the same thing in words, including the blocking link.
    await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "List" }).click();
    await expect(page).toHaveURL(/view=list/);
    const venueItem = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `${marker} book venue`, exact: true }) }).first();
    await expect(venueItem).toContainText("contains");
    await expect(page.getByRole("listitem").filter({ hasText: "is inside" }).filter({ hasText: `${marker} project` }).first()).toBeVisible();
    await expectAccessible(page);

    // Filter to tasks only, from the form, without a centre.
    await page.getByLabel("Centre on").selectOption("");
    for (const type of ["Programme", "Project", "Milestone"]) await page.getByLabel(type, { exact: true }).uncheck();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/type=task/);
    await expect(page.getByRole("link", { name: `${marker} project`, exact: true })).toHaveCount(0);
    const invitesItem = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `${marker} send invites`, exact: true }) });
    await expect(invitesItem.filter({ hasText: "is blocked by" }).first()).toBeVisible();

    // French.
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Graphe des liens" })).toBeVisible();
  } finally {
    setLensesSwitch(before);
    sql(`delete from project where id = '${project}'`);
  }
});
