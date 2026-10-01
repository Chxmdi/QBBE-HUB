import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M11 (epic #199): comments on any object, behind the editor
 * switch. A thread with an @mention, a reaction, a reply, resolve and reopen;
 * the mentioned person is notified; the screen passes axe in both languages.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

test("a comment thread on an object: mention, react, reply, resolve and reopen", async ({ page }) => {
  test.setTimeout(180_000);
  // The module is merged dark; the test turns its switch on. Nothing turns it
  // off again, so parallel specs never see it flip.
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");

  const suffix = randomUUID().slice(0, 8);
  const title = `Object comments ${suffix}`;
  const taskId = sql(`
    with org as (select organization_id from public.organization_membership where user_id = '${OWNER}'),
    prog as (
      insert into public.program (organization_id, name, slug, created_by)
      select organization_id, 'Comments ${suffix}', 'oc-${suffix}', '${OWNER}' from org returning id, organization_id
    ),
    proj as (
      insert into public.project (organization_id, program_id, name, owner_id, created_by)
      select organization_id, id, 'Comments ${suffix}', '${OWNER}', '${OWNER}' from prog returning id, organization_id
    )
    insert into public.task (organization_id, project_id, title, created_by, assignee_id)
    select organization_id, id, '${title}', '${OWNER}', '${VOLUNTEER}' from proj returning id;
  `);

  await signIn(page, "owner");
  await page.goto(`/collab/objects/${taskId}?type=task`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByText("No comments yet.")).toBeVisible();

  // Mention the volunteer from the @ picker, by keyboard only.
  const box = page.getByRole("textbox", { name: "Comment" });
  await box.click();
  await box.pressSequentially("Please check this @QA Vol");
  const options = page.getByRole("listbox", { name: "Mention suggestions" });
  await expect(options.getByRole("option", { name: "Person: QA Volunteer" })).toBeVisible();
  await box.press("Enter");
  await expect(box).toHaveValue(new RegExp(`@\\[QA Volunteer\\]\\(person:${VOLUNTEER}\\) $`));
  await box.pressSequentially("thanks");
  await page.getByRole("button", { name: "Post comment" }).click();

  const thread = page.getByRole("article", { name: /^QA Owner, / }).first();
  await expect(thread.getByText("@QA Volunteer")).toBeVisible();
  await expect(thread.getByText(/thanks$/)).toBeVisible();

  // The volunteer, who can open the task, is told.
  await expect
    .poll(() =>
      sql(
        `select count(*) from public.notification where user_id = '${VOLUNTEER}' and category = 'mention' and link like '/collab/objects/${taskId}%'`,
      ),
    )
    .toBe("1");

  // React, then take it back.
  await thread.getByRole("button", { name: "Add reaction" }).click();
  await thread.getByRole("button", { name: "React with thumbs up" }).click();
  const thumbs = thread.getByRole("button", { name: /^thumbs up: 1\. QA Owner$/ });
  await expect(thumbs).toHaveAttribute("aria-pressed", "true");

  // Reply.
  await thread.getByRole("button", { name: "Reply to QA Owner" }).click();
  await page.getByRole("textbox", { name: "Reply to QA Owner" }).fill("Done on my side.");
  await page.getByRole("button", { name: "Post reply" }).click();
  const replies = page.getByRole("list", { name: "Replies" });
  await expect(replies.getByText("Done on my side.")).toBeVisible();

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, "axe on the object comments screen").toEqual([]);

  // Resolve: the open filter empties; the resolved filter shows who resolved it.
  await thread.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("No comments yet.")).toBeVisible();
  await page.getByRole("radio", { name: "Resolved" }).check();
  await expect(page.getByText("Resolved by QA Owner")).toBeVisible();
  await page.getByRole("button", { name: "Reopen" }).click();
  await page.getByRole("radio", { name: "Open" }).check();
  await expect(page.getByRole("article", { name: /^QA Owner, / }).first()).toBeVisible();

  // French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: /Commentaires/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publier le commentaire" })).toBeVisible();
  const scanFr = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scanFr.violations, "axe on the object comments screen in French").toEqual([]);
});

test("the object comments screen stays hidden from people who cannot open the object", async ({ page }) => {
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");
  const taskId = sql(`
    with org as (select organization_id from public.organization_membership where user_id = '${OWNER}')
    insert into public.task (organization_id, title, created_by)
    select organization_id, 'Private to leadership ${randomUUID().slice(0, 8)}', '${OWNER}' from org returning id;
  `);
  await signIn(page, "volunteer");
  await page.goto(`/collab/objects/${taskId}?type=task`);
  await expect(page.getByText("This object does not exist or you can't open it.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
});
