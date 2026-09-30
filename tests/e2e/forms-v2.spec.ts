import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/** Serious or critical WCAG 2.2 AA violations on the current page. */
async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

const setSwitch = (on: boolean) =>
  sql(`update feature_flag set enabled = ${on} where key = 'wos_forms_v2' and organization_id is null`);

/**
 * Forms for any type (V1-6): an admin builds a task form, opens it, and a
 * volunteer's answer becomes a task they requested. The screens are hidden
 * while the wos_forms_v2 switch is off.
 */
test("a task form turns an answer into a task, and is hidden while its switch is off", async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const formTitle = `Help request ${stamp}`;
  const taskTitle = `Chairs for the gala ${stamp}`;

  setSwitch(false);
  try {
    await signIn(page, "owner");
    const hidden = await page.goto("/forms-v2");
    expect(hidden?.status(), "the module is hidden while its switch is off").toBe(404);

    setSwitch(true);
    await page.goto("/forms-v2/new");
    await expect(page.getByRole("heading", { name: "New form", level: 1 })).toBeVisible();
    expect(await axeProblems(page), "builder accessibility").toEqual([]);

    await page.getByLabel("Title (English)").fill(formTitle);
    await page.getByLabel("Title (French)").fill(`Demande d’aide ${stamp}`);
    await expect(page.getByLabel("A task")).toBeChecked();
    // Ask for the priority too; the title is always asked.
    await page.getByRole("checkbox", { name: /Ask this: Priority/ }).check();
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByRole("heading", { name: formTitle, level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("This form is a draft.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Open the form" }).click();
    await expect(page.getByRole("status").filter({ hasText: "The form is open." })).toBeVisible();
    const formUrl = page.url();
    expect(await axeProblems(page), "form accessibility").toEqual([]);

    await signOut(page);
    await signIn(page, "volunteer");
    await page.goto(formUrl);
    await expect(page.getByRole("heading", { name: formTitle, level: 1 })).toBeVisible();
    await page.getByLabel("Priority").selectOption({ label: "High" });
    // Keyboard only: type the title and press Enter to send.
    const titleField = page.getByLabel(/^Title/);
    await titleField.fill(taskTitle);
    await titleField.press("Enter");
    await expect(page.getByText("Your request is now a task.")).toBeVisible({ timeout: 20_000 });

    const created = sql(
      `select t.priority::text || '|' || (t.requester_id = p.id)::text
       from task t join user_profile p on p.email = 'qa-volunteer@example.com'
       where t.title = '${taskTitle}'`,
    );
    expect(created).toBe("high|true");

    // The same form in Quebec French.
    await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.goto("/forms-v2");
    await expect(page.getByRole("heading", { name: "Formulaires", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: `Demande d’aide ${stamp}` })).toBeVisible();
    expect(await axeProblems(page), "French list accessibility").toEqual([]);
  } finally {
    setSwitch(false);
    sql(`delete from task where title = '${taskTitle}'`);
    sql(`delete from form_v2 where title_en = '${formTitle}'`);
  }
});
