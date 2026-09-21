import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Acceptance evidence for #28 (P0-MIL-01).
 *
 * `owner_id`, `description`, `status` and `evidence` have been columns on
 * `milestone` since `20260912040000` and were touched by no application code,
 * so everything here is being shown for the first time. The two claims only a
 * browser settles: that completion evidence survives a reload, and that the
 * order somebody arranges is the order that comes back.
 */

async function createProject(page: Page, name: string) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });
  return page.url().split("/").pop() as string;
}

async function addMilestone(page: Page, name: string, owner?: string) {
  await page.getByRole("button", { name: "Add milestone" }).click();
  const dialog = page.getByRole("dialog", { name: "Add milestone" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  // Optional fields in EntityFormDialog carry "(optional)" in their label, so
  // these are substring matches on purpose.
  if (owner) await dialog.getByLabel("Owner").selectOption({ label: owner });
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  // The dialog closes on a successful action, but the rail only shows the new
  // milestone once the refreshed page comes back. Waiting for the row is what
  // makes three additions in a row deterministic.
  await expect(
    page.getByRole("region", { name: "Milestones", exact: true }).getByText(name),
  ).toBeVisible({ timeout: 30_000 });
}

test("a milestone carries an owner and a description, and keeps them", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const stamp = Date.now();
  await createProject(page, `Milestone detail ${stamp}`);
  await addMilestone(page, `Venue confirmed ${stamp}`, "QA Staff");

  const rail = page.getByRole("region", { name: "Milestones", exact: true });
  await expect(rail.getByText(`Venue confirmed ${stamp}`)).toBeVisible({
    timeout: 30_000,
  });
  // Visible-only: the Add-milestone dialog stays mounted, and its owner picker
  // holds the same name as an <option> that is never on screen.
  await expect(rail.getByText("QA Staff").filter({ visible: true })).toBeVisible();
  // A new milestone is planned, not silently completed.
  await expect(rail.getByText("Planned", { exact: true })).toBeVisible();

  await rail.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: `Edit “Venue confirmed ${stamp}”` });
  await edit
    .getByLabel("Description", { exact: true })
    .fill("Contract signed, deposit paid.");
  await edit.getByLabel("Status", { exact: true }).selectOption("in_progress");
  await edit.getByRole("button", { name: "Save milestone" }).click();
  await expect(edit).not.toBeVisible({ timeout: 30_000 });

  await page.reload();
  const reloaded = page.getByRole("region", { name: "Milestones", exact: true });
  await expect(reloaded.getByText("Contract signed, deposit paid.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(reloaded.getByText("In progress", { exact: true })).toBeVisible();
});

test("completing a milestone demands evidence, and the evidence survives a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const stamp = Date.now();
  const projectId = await createProject(page, `Milestone evidence ${stamp}`);
  await addMilestone(page, `Registration open ${stamp}`);

  const rail = page.getByRole("region", { name: "Milestones", exact: true });
  await rail.getByRole("button", { name: "Complete", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: `Complete “Registration open ${stamp}”`,
  });

  // The field is required, so the browser refuses before the server is asked.
  const evidence = dialog.getByLabel("What shows this milestone was met?", {
    exact: true,
  });
  await expect(evidence).toHaveAttribute("required", "");

  await evidence.fill("Registration page live, 31 sign-ups on day one.");
  await dialog.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  await page.reload();
  const reloaded = page.getByRole("region", { name: "Milestones", exact: true });
  await expect(
    reloaded.getByText("Registration page live, 31 sign-ups on day one."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(reloaded.getByText("Completed", { exact: true })).toBeVisible();

  // Status and completed_at are one fact with two spellings. Before the
  // trigger, completing wrote only the timestamp and the enum stayed 'planned'.
  const row = sql(
    `select status || '|' || (completed_at is not null)::text
     from milestone where project_id = '${projectId}'`,
  );
  expect(row).toBe("completed|true");

  // Reopening clears the evidence: evidence for a completion that was undone
  // is evidence for nothing, and leaving it would satisfy the next completion
  // without anybody having looked at it.
  await reloaded.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Milestones", exact: true }).getByText("Planned", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });

  const reopened = sql(
    `select status || '|' || coalesce(evidence, 'none') || '|' ||
            (completed_at is null)::text
     from milestone where project_id = '${projectId}'`,
  );
  expect(reopened).toBe("planned|none|true");
});

test("milestones keep the order somebody arranged, and can be deleted", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const stamp = Date.now();
  const projectId = await createProject(page, `Milestone order ${stamp}`);
  await addMilestone(page, `Alpha ${stamp}`);
  await addMilestone(page, `Beta ${stamp}`);
  await addMilestone(page, `Gamma ${stamp}`);

  const rail = page.getByRole("region", { name: "Milestones", exact: true });
  const names = async () =>
    (await rail.locator("li").allInnerTexts()).map((text) => text.split("\n")[0].trim());

  expect(await names()).toEqual([`Alpha ${stamp}`, `Beta ${stamp}`, `Gamma ${stamp}`]);

  // Move-up and move-down buttons, not drag alone: the board shipped a
  // drag-only reorder in #30 that no keyboard could operate.
  await rail.getByRole("button", { name: `Move Gamma ${stamp} up` }).click();
  await expect
    .poll(names, { timeout: 30_000 })
    .toEqual([`Alpha ${stamp}`, `Gamma ${stamp}`, `Beta ${stamp}`]);

  await page.reload();
  expect(await names()).toEqual([`Alpha ${stamp}`, `Gamma ${stamp}`, `Beta ${stamp}`]);

  // The first milestone cannot move further up, and the button says so rather
  // than failing when pressed.
  await expect(
    rail.getByRole("button", { name: `Move Alpha ${stamp} up` }),
  ).toBeDisabled();

  await rail
    .locator("li")
    .filter({ hasText: `Beta ${stamp}` })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect
    .poll(names, { timeout: 30_000 })
    .toEqual([`Alpha ${stamp}`, `Gamma ${stamp}`]);

  const remaining = sql(
    `select count(*)::text from milestone where project_id = '${projectId}'`,
  );
  expect(remaining).toBe("2");
});

test("a volunteer sees a project's milestones without any way to change them", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // The seeded project the volunteer holds through a program, so this is a
  // read-without-write case rather than a no-access case.
  const projectId = sql(
    "select id::text from project where name = 'Fall Community Workshop Series' limit 1",
  );
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/);

  await signIn(page, "volunteer");
  await page.goto(`/projects/${projectId}`);

  await expect(page.getByRole("button", { name: "Add milestone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move /, })).toHaveCount(0);
});
