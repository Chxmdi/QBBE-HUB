import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Acceptance evidence for #26 (P0-PROG-01, P0-PROG-02).
 *
 * The parts that can only be shown in a browser: that a stored value is
 * actually rendered rather than merely saved, and that changing the lead moves
 * real capability from one person to another.
 */

async function createProgram(page: import("@playwright/test").Page, name: string) {
  await page.goto("/programs?create=1");
  // Scoped to the dialog: /programs also carries the "Save template" form, so a
  // page-wide "Name" now matches two fields.
  const create = page.getByRole("dialog", { name: "Create program" });
  await create.getByLabel("Name", { exact: true }).fill(name);
  await create.getByRole("button", { name: "Create program", exact: true }).click();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/, { timeout: 60_000 });
}

test("a program's colour and links survive a save and are actually shown", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const name = `Program overview ${Date.now()}`;
  await createProgram(page, name);

  await page.getByRole("button", { name: "Edit program" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit program" });
  await dialog.getByLabel("Colour", { exact: true }).selectOption("green");
  await dialog
    .getByLabel("Important links", { exact: true })
    // The second line is not http(s) and must not survive: these render as
    // anchors, so storing it would be stored XSS.
    .fill("Program handbook|https://qbbe.ca/handbook\nBad|javascript:alert(1)");
  await dialog.getByRole("button", { name: "Save program" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  // Re-read from the server rather than trusting the optimistic view.
  await page.reload();
  const handbook = page.getByRole("link", { name: "Program handbook", exact: true });
  await expect(handbook).toBeVisible({ timeout: 30_000 });
  await expect(handbook).toHaveAttribute("href", "https://qbbe.ca/handbook");
  await expect(page.getByRole("link", { name: "Bad", exact: true })).toHaveCount(0);

  // The colour round-trips through the form rather than silently resetting.
  await page.getByRole("button", { name: "Edit program" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit program" }).getByLabel("Colour", { exact: true }),
  ).toHaveValue("green");
});

test("changing the program lead moves who can manage it", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const name = `Program lead ${Date.now()}`;
  await createProgram(page, name);
  const programUrl = page.url();

  // A volunteer holds nothing on this program to begin with.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(programUrl);
  await expect(page.getByRole("button", { name: "Edit program" })).toHaveCount(0);

  // Hand them the lead role.
  await signOut(page);
  await signIn(page, "owner");
  await page.goto(programUrl);
  await page.getByRole("button", { name: "Edit program" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit program" });
  await dialog.getByLabel("Program lead", { exact: true }).selectOption({ label: "QA Volunteer" });
  await dialog.getByRole("button", { name: "Save program" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  // The lead is capability, not decoration: they can now manage the program.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(programUrl);
  await expect(page.getByRole("button", { name: "Edit program" })).toBeVisible({
    timeout: 30_000,
  });
});

test("the program overview shows the team and the latest project update", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // The seeded programme already has projects and a published status update,
  // which is what makes this assertion about composition rather than fixtures.
  await page.goto("/programs");
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Family First", exact: true }) })
    .click();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/, { timeout: 60_000 });

  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Latest updates", exact: true }),
  ).toBeVisible();

  // The owner holds the programme through being its lead, so the team panel
  // must not be empty on a programme that plainly has one.
  const team = page.getByRole("region", { name: "Team" });
  await expect(team.getByText("QA Owner", { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test("a volunteer cannot reach a program they hold nothing on", async ({ page }) => {
  test.setTimeout(180_000);
  const id = sql("select id::text from program where name = 'Family First' limit 1");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  await signIn(page, "volunteer");
  await page.goto(`/programs/${id}`);
  // RLS returns no row, so the page is a not-found rather than a redirect.
  await expect(page.getByRole("button", { name: "Edit program" })).toHaveCount(0);
  await expect(page.getByText("Latest updates", { exact: true })).toHaveCount(0);
});

test("an approved template builds a program with its projects and milestones", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const projectTemplateName = `Template project ${stamp}`;
  const programTemplateName = `Template program ${stamp}`;

  await signIn(page, "owner");

  // The project template and its work items are the structure being reused.
  await page.goto("/projects");
  await page.getByRole("button", { name: "Save template", exact: true }).click();
  const projectTemplateDialog = page.getByRole("dialog", { name: "Project template" });
  await projectTemplateDialog.getByLabel("Name", { exact: true }).fill(projectTemplateName);
  await projectTemplateDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(projectTemplateDialog).not.toBeVisible({ timeout: 30_000 });

  // A milestone on the project template, so the expansion has something to date.
  const projectTemplateId = sql(
    `select id::text from project_template where name = '${projectTemplateName}' limit 1`,
  );
  expect(projectTemplateId).toMatch(/^[0-9a-f-]{36}$/);
  sql(
    `insert into project_template_item (project_template_id, kind, name, day_offset, sort_key)
     values ('${projectTemplateId}', 'milestone', 'Kickoff ${stamp}', 7, 0)`,
  );

  await page.goto("/programs");
  await page.getByRole("button", { name: "Save template", exact: true }).click();
  const programTemplateDialog = page.getByRole("dialog", { name: "Program template" });
  await programTemplateDialog.getByLabel("Name", { exact: true }).fill(programTemplateName);
  await programTemplateDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(programTemplateDialog).not.toBeVisible({ timeout: 30_000 });

  const templateRow = page.getByRole("listitem").filter({ hasText: programTemplateName });
  await templateRow
    .getByLabel(`Add a project template to ${programTemplateName}`)
    .selectOption({ label: projectTemplateName });
  await expect(templateRow.getByText(projectTemplateName)).toBeVisible({ timeout: 30_000 });

  // Unapproved, it is not offered as something to build from.
  await expect(templateRow.getByText("Not approved", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Create program from template").getByRole("option", {
      name: programTemplateName,
    }),
  ).toHaveCount(0);

  await templateRow.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(templateRow.getByText("Approved", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Now it builds a real program, with the project and its dated milestone.
  await page
    .getByLabel("Create program from template")
    .selectOption({ label: programTemplateName });
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(
    page.getByRole("heading", { name: programTemplateName, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: projectTemplateName })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("link", { name: projectTemplateName }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });

  // Scoped to the Milestones rail: the name also appears in the task dialog's
  // milestone picker and in the activity feed, so a page-wide match is ambiguous.
  const milestones = page.getByRole("region", { name: "Milestones" });
  await expect(milestones.getByText(`Kickoff ${stamp}`, { exact: false })).toBeVisible({
    timeout: 30_000,
  });

  // The template stored an offset, not a date. Seven days on from the day it
  // was expanded is the whole point of storing an offset, so check the date
  // rather than only that a milestone exists.
  const due = sql(
    `select to_char(m.due_date, 'YYYY-MM-DD') from milestone m
     where m.name = 'Kickoff ${stamp}' limit 1`,
  );
  // In the organization's zone, not the database's. current_date is UTC, which
  // between 20:00 and midnight in Toronto has already rolled into tomorrow —
  // the same clock mistake that made dated assertions fail overnight in #30.
  const expected = sql(
    "select to_char((timezone('America/Toronto', now()))::date + 7, 'YYYY-MM-DD')",
  );
  expect(due).toBe(expected);
});
