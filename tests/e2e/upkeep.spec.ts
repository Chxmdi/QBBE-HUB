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

const setSwitch = (on: boolean) =>
  sql(`update feature_flag set enabled = ${on} where key = 'wos_objects' and organization_id is null`);

/**
 * Workspace upkeep (V3-2): the owner sees a stale page with its owner and
 * confirms it is still current, and sees possible duplicate tasks.
 */
test("upkeep lists a stale page for review and possible duplicates", async ({ page, context }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const docTitle = `Old handbook ${stamp}`;
  const taskTitle = `Order chairs ${stamp}`;
  const ownerId = sql(`select id from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id from organization_membership where user_id = '${ownerId}' limit 1`);
  const docId = sql(
    `insert into document (organization_id, title, kind, url, owner_id)
     values ('${orgId}', '${docTitle}', 'link', 'https://drive.google.com/file/d/${stamp}', '${ownerId}') returning id`,
  );
  sql(`set session_replication_role = replica; update document set updated_at = now() - interval '400 days' where id = '${docId}'`);
  sql(`insert into task (organization_id, title, created_by) values ('${orgId}', '${taskTitle}', '${ownerId}'), ('${orgId}', '${taskTitle.toLowerCase()}!', '${ownerId}')`);
  setSwitch(false);
  try {
    await signIn(page, "owner");
    await page.goto("/upkeep");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();

    setSwitch(true);
    await page.goto("/upkeep?days=365");
    await expect(page.getByRole("heading", { name: "Workspace upkeep", level: 1 })).toBeVisible();
    const stale = page.getByRole("listitem").filter({ hasText: docTitle });
    await expect(stale.getByText(/Idle 4\d\d days · Owner: /)).toBeVisible();
    // Both tasks were inserted in one statement, so they share a created_at
    // and either may be listed first.
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "2 with the same name:" })
        .filter({ hasText: `“${taskTitle}”` })
        .filter({ hasText: `“${taskTitle.toLowerCase()}!”` }),
    ).toBeVisible();
    expect(await axeProblems(page), "upkeep accessibility").toEqual([]);

    await page.getByRole("button", { name: `Still current: ${docTitle}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "Marked as still current." })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: docTitle })).toHaveCount(0);

    sql(`update user_profile set locale = 'fr-CA' where id = '${ownerId}'`);
    await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.goto("/upkeep");
    await expect(page.getByRole("heading", { name: "Entretien de l’espace", level: 1 })).toBeVisible();
    expect(await axeProblems(page), "French upkeep accessibility").toEqual([]);
  } finally {
    setSwitch(false);
    sql(`update user_profile set locale = null where id = '${ownerId}'`);
    sql(`delete from upkeep_review where object_id = '${docId}'`);
    sql(`delete from document where id = '${docId}'`);
    sql(`delete from task where title in ('${taskTitle}', '${taskTitle.toLowerCase()}!')`);
  }
});
