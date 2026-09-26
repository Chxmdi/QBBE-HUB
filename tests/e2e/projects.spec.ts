import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Acceptance evidence for #27 (P0-PRJ-01..06, P1-PRJ-07..09).
 *
 * The parts that only a browser can show: that a field the schema accepted is
 * actually reachable and actually comes back after a reload, that an archived
 * project can still be found, that a returned request can be answered by the
 * person who raised it, and that a project built from a template arrives with
 * the template's work and nothing else.
 */

async function createProject(page: Page, name: string) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });
  return page.url();
}

test("a project's full detail is reachable at creation and survives a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const name = `Project detail ${Date.now()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const create = page.getByRole("dialog", { name: "Create project" });
  await create.getByLabel("Name", { exact: true }).fill(name);
  // Four fields the schema has always accepted and the form never offered, so
  // sponsor, priority, cadence and description could not be set at all.
  await create
    .getByLabel("Description", { exact: true })
    .fill("Background for a newcomer.");
  await create
    .getByLabel("Sponsor", { exact: true })
    .selectOption({ label: "QA Staff" });
  await create.getByLabel("Priority", { exact: true }).selectOption("high");
  await create
    .getByLabel("Reporting cadence", { exact: true })
    .selectOption("weekly");
  await create
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });

  // Re-read from the server rather than trusting what the form just showed.
  // The sponsor block prints "Not named" when there is none, so its absence is
  // the assertion that the stored sponsor reached the page — a bare text match
  // on the name would also match the hidden <option> in the owner picker.
  await page.reload();
  await expect(page.getByText("Not named")).toHaveCount(0, { timeout: 30_000 });
  // Visible-only: the same name also sits in the closed edit dialog's sponsor
  // picker as an <option>, which matches a text locator but is never on screen.
  await expect(
    page.getByText("QA Staff").filter({ visible: true }),
  ).toBeVisible({ timeout: 30_000 });

  // updateProject was dead code: nothing in the application called it.
  await page.getByRole("button", { name: "Edit project" }).click();
  const edit = page.getByRole("dialog", { name: "Edit project" });
  await expect(edit.getByLabel("Priority", { exact: true })).toHaveValue(
    "high",
  );
  await expect(
    edit.getByLabel("Reporting cadence", { exact: true }),
  ).toHaveValue("weekly");
  await edit
    .getByLabel("Outcome", { exact: true })
    .fill("Forty families served.");
  await edit.getByLabel("Priority", { exact: true }).selectOption("critical");
  await edit.getByRole("button", { name: "Save project" }).click();
  await expect(edit).not.toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(
    page.getByText("Forty families served.").filter({ visible: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit project" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Edit project" })
      .getByLabel("Priority", { exact: true }),
  ).toHaveValue("critical");
});

test("an archived project can still be found, and restored", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const name = `Archive round trip ${Date.now()}`;
  const url = await createProject(page, name);

  await page.getByLabel("Project stage").selectOption("archived");
  // StageSelect moves its own value before the server answers, so the value is
  // not proof. The close control disappears only after the refreshed page comes
  // back from the server saying the project really is archived.
  await expect(page.getByRole("button", { name: "Close project" })).toHaveCount(
    0,
    {
      timeout: 30_000,
    },
  );

  // The directory filtered `archived_at is null` unconditionally, so an
  // archived project was reachable only by somebody who already knew its URL.
  await page.goto("/projects");
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);

  await page.goto("/projects?archived=1");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto(url);
  await page.getByLabel("Project stage").selectOption("planning");
  await expect(page.getByRole("button", { name: "Close project" })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await page.goto("/projects");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test("a returned request goes back to its author, and comes back answered", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const title = `Homework club ${Date.now()}`;

  // The volunteer proposes it.
  await signIn(page, "volunteer");
  await page.goto("/requests");
  await page.getByRole("button", { name: "Propose something" }).click();
  const propose = page.getByRole("dialog", { name: "Propose a project" });
  await propose
    .getByLabel("What are you proposing", { exact: true })
    .fill(title);
  await propose
    .getByLabel("What would it involve", { exact: true })
    .fill("A weekly drop-in.");
  await propose.getByRole("button", { name: "Submit request" }).click();
  await expect(propose).not.toBeVisible({ timeout: 30_000 });

  // A reviewer sends it back with a specific question.
  await signOut(page);
  await signIn(page, "owner");
  await page.goto("/requests");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Decide", exact: true }).click();
  await row.getByLabel("Decision", { exact: true }).selectOption("returned");
  await row
    .getByLabel("What is missing? Ask for one specific thing.", { exact: true })
    .fill("Which school, and how many places?");
  await row.getByRole("button", { name: "Return for clarification" }).click();
  // The form closes on success, so the Decide button coming back is the signal
  // that the server accepted it rather than that the click landed.
  await expect(
    row.getByRole("button", { name: "Decide", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    row.getByText("Returned for clarification").first(),
  ).toBeVisible();

  // Deferring and returning are decisions the database demands attribution
  // for. Before this, the command wrote a null decider and the row was refused.
  const decided = sql(
    `select (decided_by is not null and decided_at is not null)::text
     from project_request where title = '${title}'`,
  );
  expect(decided).toBe("true");

  // The author sees the question and can answer it. The old edit policy froze
  // a returned request, so this was a dead end.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto("/requests");
  const mine = page.getByRole("listitem").filter({ hasText: title });
  await expect(
    mine.getByText("Which school, and how many places?"),
  ).toBeVisible({
    timeout: 30_000,
  });
  await mine.getByRole("button", { name: "Answer and resubmit" }).click();
  await mine
    .getByLabel("What would it involve", { exact: true })
    .fill("Parkdale PS, twenty places, Saturdays 10-12.");
  await mine.getByRole("button", { name: "Resubmit", exact: true }).click();

  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByText("Submitted", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  const status = sql(
    `select status || '|' || coalesce(decided_by::text, 'none')
     from project_request where title = '${title}'`,
  );
  expect(status).toBe("submitted|none");
});

test("closing a project records evidence that is still there after a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const name = `Closure evidence ${Date.now()}`;
  await createProject(page, name);

  await page.getByRole("button", { name: "Close project" }).click();
  const dialog = page.getByRole("dialog", { name: `Close “${name}”` });
  await dialog
    .getByLabel("What did this project deliver?", { exact: true })
    .fill("Forty-eight families served over twelve weeks.");
  await dialog
    // The label carries "(optional)", so this is a substring match on purpose.
    .getByLabel("Evidence links")
    .fill("Final report|https://qbbe.ca/report\nBad|javascript:alert(1)");
  await dialog.getByRole("button", { name: "Close project" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 60_000 });

  await page.reload();
  const closure = page.getByRole("region", { name: "How it ended" });
  await expect(closure).toBeVisible({ timeout: 30_000 });
  // Scoped to the closure record: the closing status update quotes the same
  // sentence back in the updates feed, which is a second, legitimate match.
  await expect(
    closure.getByText("Forty-eight families served over twelve weeks.", {
      exact: true,
    }),
  ).toBeVisible();

  const report = closure.getByRole("link", {
    name: "Final report",
    exact: true,
  });
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute("href", "https://qbbe.ca/report");
  // These render as anchors, so a non-http scheme surviving would be stored XSS.
  await expect(
    closure.getByRole("link", { name: "Bad", exact: true }),
  ).toHaveCount(0);
});

test("a project built from a template carries its work and none of its history", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const templateName = `Workshop series ${stamp}`;
  await signIn(page, "owner");

  await page.goto("/projects");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  const saveTemplate = page.getByRole("dialog", { name: "Project template" });
  await saveTemplate.getByLabel("Name", { exact: true }).fill(templateName);
  await saveTemplate.getByRole("button", { name: "Save", exact: true }).click();
  await expect(saveTemplate).not.toBeVisible({ timeout: 30_000 });

  // Structure, through the interface. Until this existed a template carried a
  // name and a stage, so "create from template" saved one form field.
  const structure = page
    .getByRole("listitem")
    .filter({ hasText: templateName });
  await structure.getByLabel("Kind", { exact: true }).selectOption("milestone");
  await structure
    .getByLabel("Name", { exact: true })
    .fill(`Venue confirmed ${stamp}`);
  await structure.getByLabel("Day", { exact: true }).fill("7");
  await structure.getByRole("button", { name: "Add", exact: true }).click();
  await expect(structure.getByText(`Venue confirmed ${stamp}`)).toBeVisible({
    timeout: 30_000,
  });

  await structure.getByLabel("Kind", { exact: true }).selectOption("task");
  await structure
    .getByLabel("Name", { exact: true })
    .fill(`Book the room ${stamp}`);
  await structure.getByLabel("Day", { exact: true }).fill("1");
  await structure.getByRole("button", { name: "Add", exact: true }).click();
  await expect(structure.getByText(`Book the room ${stamp}`)).toBeVisible({
    timeout: 30_000,
  });

  // A template is offered for use only once an administrator approves it
  // (P1-ADM-03). The approval itself is covered by epic05-administration;
  // here it is granted directly so this test stays about what a build copies.
  sql(`
    update project_template
    set approved_at = now(),
        approved_by = created_by
    where name = '${templateName}';
  `);
  await page.reload();
  await page
    .getByLabel("Create from template")
    .selectOption({ label: templateName });
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });
  const projectId = page.url().split("/").pop() as string;

  await expect(
    page
      .getByRole("region", { name: "Milestones" })
      .getByText(`Venue confirmed ${stamp}`),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Book the room ${stamp}`).first()).toBeVisible({
    timeout: 30_000,
  });

  // The milestone is dated from today in the organization's zone, not UTC.
  const due = sql(
    `select due_date::text from milestone
     where project_id = '${projectId}' and name = 'Venue confirmed ${stamp}'`,
  );
  const expected = sql(
    "select (timezone('America/Toronto', now())::date + 7)::text",
  );
  expect(due).toBe(expected);

  // The property P1-PRJ-09 actually asks for: no comments, no private notes,
  // no borrowed history. The new project's activity is its own.
  const comments = sql(
    `select count(*)::text from record_comment
     where parent_type = 'project' and parent_id = '${projectId}'`,
  );
  expect(comments).toBe("0");

  const borrowed = sql(
    `select count(*)::text from activity_event
     where project_id = '${projectId}' and created_at < now() - interval '1 hour'`,
  );
  expect(borrowed).toBe("0");
});

test("a project page shows where it sits, and the trail leads back (P0-UX-01)", async ({
  page,
}) => {
  await signIn(page, "owner");
  await page.goto("/projects");
  await page.locator('main a[href^="/projects/"]').first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);

  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  const title = (
    await page.getByRole("heading", { level: 1 }).innerText()
  ).trim();
  await expect(trail.locator('[aria-current="page"]')).toHaveText(title);

  await trail.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});
