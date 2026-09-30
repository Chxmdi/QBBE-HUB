import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V2-4 (epic #199): an admin arranges the task page layout by
 * keyboard-reachable buttons, saves it, and a task renders with it.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test("arrange and save a task page layout, then preview a task with it", async ({ page }) => {
  test.setTimeout(180_000);
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");
  sql(`delete from public.object_layout where type_id in (select id from public.object_type where key = 'task')`);
  const title = `Layout ${randomUUID().slice(0, 8)}`;
  sql(`
    insert into public.task (organization_id, title, description, priority, created_by)
    select organization_id, '${title}', 'Venue and catering.', 'high', '${OWNER}'
    from public.organization_membership where user_id = '${OWNER}';
  `);

  await signIn(page, "owner");
  await page.goto("/collab/layouts");
  await page.getByRole("link", { name: "Edit layout for Task" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Task page layout" })).toBeVisible();

  // Remove every property but Title and Priority, put Priority first.
  const properties = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Properties" }) });
  for (const name of ["Status", "Assignee", "Requester", "Reviewer", "Start", "Due", "Estimate (hours)", "Project", "Program", "Completed", "Created by", "Created", "Last edited"]) {
    await properties.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
  }
  await properties.getByRole("button", { name: "Move Priority up" }).click();
  await page.getByLabel("Heading (English, optional)").first().fill("At a glance");
  await expect(page.getByText(/^Not shown anywhere: Status, /)).toBeVisible();

  // Comments above content (past the three related lists and the content).
  for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Move Comments up" }).click();

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, "axe on the layout editor").toEqual([]);

  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByText("Layout saved.")).toBeVisible();
  expect(
    sql(`select layout->'sections'->0->'properties' from public.object_layout l join public.object_type t on t.id = l.type_id where t.key = 'task'`),
  ).toBe('["priority", "title"]');

  // Preview a task with it.
  await page.getByLabel("Task to preview").selectOption({ label: title });
  await page.getByRole("button", { name: "Open preview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const headings = await page.locator("main").getByRole("heading", { level: 2 }).allInnerTexts();
  expect(headings.slice(0, 2)).toEqual(["At a glance", "Comments"]);
  const glance = page.getByRole("region", { name: "At a glance" });
  await expect(glance.getByText("Priority")).toBeVisible();
  await expect(glance.getByText("high")).toBeVisible();
  await expect(glance.getByText("Status")).toHaveCount(0);
  await expect(page.getByText("Venue and catering.")).toBeVisible();

  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Commentaires" })).toBeVisible();
  const scanFr = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scanFr.violations, "axe on a task drawn with its layout, in French").toEqual([]);
});

test("members see layouts but only owners and admins can change them", async ({ page }) => {
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");
  await signIn(page, "staff");
  await page.goto("/collab/layouts/task");
  await expect(page.getByText("Only owners and admins can change layouts.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save layout" })).toHaveCount(0);
});
