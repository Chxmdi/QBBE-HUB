import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { expectAccessible, qaIds, setLensesSwitch } from "./insight";

/**
 * What-if timeline (V3-4): shift a milestone, preview what moves (its tasks,
 * what it blocks, the project's finish), then apply it in one step; a stale
 * preview saves nothing. Hidden until the lenses switch is on.
 */
test("the what-if timeline previews a milestone shift, refuses a stale one and applies a fresh one", async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `WhatIf ${Date.now()}`;
  const { ownerId, orgId } = qaIds();
  const before = setLensesSwitch(false);
  let project = "";
  try {
    project = sql(
      `insert into project (organization_id, name, owner_id, created_by, target_date)
       values ('${orgId}', '${marker} gala', '${ownerId}', '${ownerId}', current_date + 13) returning id`,
    );
    const venue = sql(
      `insert into milestone (project_id, name, due_date) values ('${project}', '${marker} venue', current_date + 10) returning id`,
    );
    const invites = sql(
      `insert into milestone (project_id, name, due_date) values ('${project}', '${marker} invitations', current_date + 12) returning id`,
    );
    sql(`insert into milestone_dependency (blocking_milestone_id, blocked_milestone_id) values ('${venue}', '${invites}')`);
    const task = sql(
      `insert into task (organization_id, project_id, milestone_id, title, due_at, created_by)
       values ('${orgId}', '${project}', '${venue}', '${marker} book hall', current_date + 9, '${ownerId}') returning id`,
    );

    await signIn(page, "owner");
    await page.goto("/insight/what-if");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();

    setLensesSwitch(true);
    await page.goto("/insight/what-if");
    await expect(page.getByRole("heading", { name: "What-if timeline", exact: true })).toBeVisible();
    const form = page.getByRole("form", { name: "Try a change" });
    await form.getByLabel("Milestone").selectOption(venue);
    await form.getByLabel("Move by (days)").fill("5");
    await form.getByLabel("Move by (days)").press("Enter");
    await expect(page).toHaveURL(new RegExp(`milestone=${venue}&days=5`));

    // Venue +5; invitations must follow (+4); the hall booking moves with the venue.
    await expect(page.getByText("2 milestones and 1 tasks would move.")).toBeVisible();
    const invitesRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: `${marker} invitations` }) });
    await expect(invitesRow).toContainText(`Blocked by ${marker} venue`);
    const taskRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: `${marker} book hall` }) });
    await expect(taskRow).toContainText(`Part of ${marker} venue`);
    await expect(page.getByRole("heading", { name: "Projects that would finish later" })).toBeVisible();
    await expect(page.getByText(/after its target of/)).toBeVisible();
    // Nothing is saved by previewing.
    expect(sql(`select (due_date - current_date)::text from milestone where id = '${venue}'`)).toBe("10");
    await expectAccessible(page);

    // Someone moves the task after the preview: applying saves nothing.
    sql(`update task set due_at = current_date + 8 where id = '${task}'`);
    await page.getByRole("button", { name: "Apply these changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The schedule changed since your preview" })).toBeVisible();
    expect(sql(`select (due_date - current_date)::text from milestone where id = '${venue}'`)).toBe("10");

    // The fresh preview is on screen; apply it, from the keyboard.
    const apply = page.getByRole("button", { name: "Apply these changes" });
    await apply.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Saved. 3 dates were changed." })).toBeVisible();
    expect(sql(`select (due_date - current_date)::text from milestone where id = '${venue}'`)).toBe("15");
    expect(sql(`select (due_date - current_date)::text from milestone where id = '${invites}'`)).toBe("16");
    expect(sql(`select (due_at - current_date)::text from task where id = '${task}'`)).toBe("13");

    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.goto(`/insight/what-if?milestone=${venue}&days=3`);
    await expect(page.getByRole("heading", { name: "Chronologie hypothétique", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Appliquer ces changements" })).toBeVisible();
  } finally {
    setLensesSwitch(before);
    if (project) sql(`delete from project where id = '${project}'`);
  }
});
