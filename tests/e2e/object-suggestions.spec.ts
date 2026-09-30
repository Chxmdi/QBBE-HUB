import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V1-17 part 2 (epic #199): a reviewer who cannot edit selects
 * text, suggests a change and comments on the selection; the owner accepts
 * the suggestion and the text changes.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

test("suggest an edit and comment on a selection, then accept it", async ({ browser, page }) => {
  test.setTimeout(240_000);
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");
  const title = `Suggest ${randomUUID().slice(0, 8)}`;
  const taskId = sql(`
    with t as (
      insert into public.task (organization_id, title, description, created_by)
      select organization_id, '${title}', 'Plan the spring gala dinner.', '${OWNER}'
      from public.organization_membership where user_id = '${OWNER}'
      returning id
    ), a as (
      insert into public.task_assignment (task_id, user_id, role) select id, '${STAFF}', 'reviewer' from t
    )
    select id from t;
  `);
  const path = `/collab/live/${taskId}?type=task`;

  // The reviewer can comment but not edit, so the page opens in suggesting mode.
  await signIn(page, "staff");
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const description = page.getByLabel("Description");
  await expect(description).toHaveAttribute("aria-readonly", "true");
  await description.focus();
  await description.press("Control+Home");
  for (let step = 0; step < 9; step++) await description.press("ArrowRight");
  for (let step = 0; step < 6; step++) await description.press("Shift+ArrowRight");
  await expect(page.getByText("Selected: “spring”")).toBeVisible();

  await page.getByLabel("Replace with").fill("autumn");
  await page.getByRole("button", { name: "Suggest change" }).click();
  await expect(page.getByText("Suggestion sent.")).toBeVisible();
  const suggestions = page.getByRole("region", { name: "Suggestions" });
  await expect(suggestions.locator("ins", { hasText: "autumn" })).toBeVisible();

  // The selection is still there for a comment about it.
  await description.focus();
  await description.press("Control+Home");
  for (let step = 0; step < 9; step++) await description.press("ArrowRight");
  for (let step = 0; step < 6; step++) await description.press("Shift+ArrowRight");
  await page.getByLabel("Comment on the selection").fill("Is the season decided?");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Comment posted.")).toBeVisible();
  const blockComments = page.getByRole("region", { name: /Comments on this block/ });
  await expect(blockComments.locator("blockquote", { hasText: "spring" })).toBeVisible();
  await expect(blockComments.getByText("Is the season decided?")).toBeVisible();

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, "axe on suggesting mode").toEqual([]);

  // The owner accepts.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, "owner");
  await owner.goto(path);
  await owner.getByRole("button", { name: "Accept suggestion by QA Staff" }).click();
  await expect(owner.getByText("No open suggestions.")).toBeVisible();
  await expect.poll(() => sql(`select description from public.task where id = '${taskId}'`)).toBe(
    "Plan the autumn gala dinner.",
  );
  await expect(owner.getByLabel("Description")).toHaveValue("Plan the autumn gala dinner.");

  await owner.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: owner.url() }]);
  await owner.reload();
  await expect(owner.getByText("Aucune suggestion ouverte.")).toBeVisible();
  const scanFr = await new AxeBuilder({ page: owner }).withTags(WCAG).analyze();
  expect(scanFr.violations, "axe on the live screen in French").toEqual([]);
  await ownerContext.close();
});
