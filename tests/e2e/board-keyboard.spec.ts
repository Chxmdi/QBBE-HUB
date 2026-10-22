import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Moving a card with its status select re-parents the card into another
 * column, and React unmounted the focused select: keyboard users landed on
 * <body> after every move. Focus now follows the card. Each select is also
 * named after its task, since every card's control was called "Task status".
 */

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

test("after a keyboard move, focus stays on the moved card's status select", async ({ page }) => {
  test.setTimeout(90_000);
  const org = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1;`)
    .split("\n")[0];
  const title = `Board focus ${randomUUID().slice(0, 8)}`;
  sql(`
    insert into task (organization_id, title, created_by, assignee_id, status)
    values ('${org}', '${title}', '${STAFF_ID}', '${STAFF_ID}', 'not_started');
  `);

  await signIn(page, "staff");
  await page.goto("/board");
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const select = card.getByLabel("Task status");
  await expect(select).toHaveAccessibleName(new RegExp(`Task status.*${title}`));

  await select.focus();
  await select.selectOption("in_progress");
  await expect(page.locator("section[aria-label='In progress column']").filter({ hasText: title })).toBeVisible();

  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName,
      label: el?.getAttribute("aria-label") ?? "",
      column: el?.closest("section")?.getAttribute("aria-label") ?? "",
    };
  });
  expect(focused.tag).toBe("SELECT");
  expect(focused.label).toContain(title);
  expect(focused.label).toContain("Task status");
  expect(focused.column).toBe("In progress column");
});
