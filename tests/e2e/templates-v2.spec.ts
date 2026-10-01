import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
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

// Templates appear with the object layer's switch (no separate switch exists).
const setSwitch = (on: boolean) =>
  sql(`update feature_flag set enabled = ${on} where key = 'wos_objects' and organization_id is null`);

/**
 * Templates (V1-13): the owner previews the starter space template with dates
 * counted from a chosen start, in French, then uses it to create the projects
 * and tasks in a program. Staff write their own project template.
 */
test("the templates screens are hidden while the switch is off [switch off]", async ({ page }) => {
  setSwitch(false);
  await signIn(page, "owner");
  await page.goto("/templates-v2");
  await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
});

test("a space template previews real dates and creates its projects and tasks", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const staffTemplate = `Board retreat ${stamp}`;
  setSwitch(true);
  try {
    await signIn(page, "owner");
    await page.goto("/templates-v2");
    await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
    expect(await axeProblems(page), "gallery accessibility").toEqual([]);
    await page.getByRole("link", { name: "Spaces", exact: true }).click();
    await expect(page.getByRole("link", { name: "Spaces", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Community event", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Community event", level: 1 })).toBeVisible();
    await page.getByLabel("Start date").fill("2031-03-03");
    await page.getByLabel("French").check();
    const preview = page.getByRole("region", { name: "What this creates" });
    await expect(preview.getByText("Réserver la salle")).toBeVisible();
    await expect(preview.getByText("Due Mar 10, 2031")).toBeVisible();
    expect(await axeProblems(page), "template accessibility").toEqual([]);

    const program = sql(`select name from program order by created_at limit 1`);
    await page.getByLabel("Program", { exact: true }).selectOption({ label: program });
    await page.getByRole("button", { name: "Use this template" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Created 5 records." })).toBeVisible({ timeout: 20_000 });
    expect(
      sql(`select target_date::text from project where name = 'Logistique de l’événement' and start_date = date '2031-03-03'`),
    ).toBe("2031-04-14");
  } finally {
    setSwitch(false);
    sql(`delete from project where start_date between date '2031-03-03' and date '2031-03-10'
         and name in ('Logistique de l’événement', 'Promotion')`);
  }

  // Staff write a project template with a task, published for everyone.
  setSwitch(true);
  try {
    await page.context().clearCookies();
    await signIn(page, "staff");
    await page.goto("/templates-v2/new");
    await expect(page.getByRole("heading", { name: "New template", level: 1 })).toBeVisible();
    await page.getByLabel("Name (English)").fill(staffTemplate);
    await page.getByLabel("Name (French)").fill(`Retraite du conseil ${stamp}`);
    await page.getByLabel("Task 1 · Title (English)").fill("Book the room");
    await page.getByLabel("Task 1 · Title (French)").fill("Réserver la salle");
    await page.getByLabel("Task 1 · Due, in days after the start").fill("5");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("heading", { name: staffTemplate, level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("region", { name: "What this creates" }).getByText("Book the room")).toBeVisible();
  } finally {
    setSwitch(false);
    sql(`delete from template_v2 where name_en = '${staffTemplate}'`);
  }
});
