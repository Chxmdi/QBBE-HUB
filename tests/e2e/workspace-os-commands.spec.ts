import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Command language (M15, epic #199): typed commands with autocomplete, used by
 * keyboard alone, in English and French. Behind the wos_home switch, which
 * this spec turns on for its own run and turns back off.
 */

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test.beforeAll(() => {
  sql(`update feature_flag set enabled = true where key = 'wos_home' and organization_id is null`);
});
test.afterAll(() => {
  sql(`update feature_flag set enabled = false where key = 'wos_home' and organization_id is null`);
});

test("a task is assigned and moved by typed commands, by keyboard alone", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const title = `Command target ${suffix}`;
  const org = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}'`);
  const taskId = sql(
    `insert into task (organization_id, title, created_by) values ('${org}', '${title}', '${OWNER_ID}') returning id`,
  ).split("\n")[0];
  const volunteer = sql(`select id from user_profile where full_name = 'QA Volunteer'`);

  await signIn(page, "owner");
  await page.goto("/home/commands");
  await expect(page.getByRole("heading", { name: "Commands" })).toBeVisible();
  expect(await axeProblems(page), "commands page accessibility").toEqual([]);

  const box = page.getByRole("combobox", { name: "Command" });
  await expect(box).toBeFocused();

  // Autocomplete the task from part of its title, then the person.
  await box.pressSequentially(`assign "${suffix}`);
  const list = page.getByRole("listbox", { name: "Suggestions" });
  await expect(list.getByRole("option", { name: new RegExp(title) })).toBeVisible();
  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
  await box.press("Enter");
  await expect(box).toHaveValue(`assign "${title}" to `);
  await box.pressSequentially("QA Vol");
  await expect(list.getByRole("option", { name: /QA Volunteer/ })).toBeVisible();
  expect(await axeProblems(page), "open suggestion list accessibility").toEqual([]);
  await box.press("Escape");
  await expect(list).toBeHidden();
  await box.press("Enter");

  await expect(page.getByRole("status").filter({ hasText: "Task assigned." })).toBeVisible();
  await expect.poll(() => sql(`select assignee_id from task where id = '${taskId}'`)).toBe(volunteer);

  // An unknown status is explained, not guessed.
  await box.fill(`move "${title}" to sideways`);
  await box.press("Escape");
  await box.press("Enter");
  await expect(page.getByRole("status")).toContainText("“sideways” is not a status");

  // French works too, whatever the interface language.
  await box.fill(`déplacer « ${title} » vers en cours`);
  await box.press("Escape");
  await box.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Task moved." })).toBeVisible();
  await expect.poll(() => sql(`select status from task where id = '${taskId}'`)).toBe("in_progress");

  // Show blocked tasks goes to the filtered list.
  await box.fill("show blocked tasks");
  await box.press("Escape");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/my-work\?status=blocked/);
});

test("the command page speaks French", async ({ page, context }) => {
  await signIn(page, "owner");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/home/commands");
  await expect(page.getByRole("heading", { name: "Commandes" })).toBeVisible();
  const box = page.getByRole("combobox", { name: "Commande" });
  await box.pressSequentially("aff");
  await expect(
    page.getByRole("listbox", { name: "Suggestions" }).getByRole("option", { name: /afficher les tâches bloquées/ }),
  ).toBeVisible();
  expect(await axeProblems(page), "French commands page accessibility").toEqual([]);
});

test("the command page stays hidden while the switch is off [switch off]", async ({ page }) => {
  sql(`update feature_flag set enabled = false where key = 'wos_home' and organization_id is null`);
  try {
    await signIn(page, "owner");
    await page.goto("/home/commands");
    // The workspace streams its pages, so the answer is the not-found screen
    // rather than a 404 status.
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Command" })).toHaveCount(0);
  } finally {
    sql(`update feature_flag set enabled = true where key = 'wos_home' and organization_id is null`);
  }
});
