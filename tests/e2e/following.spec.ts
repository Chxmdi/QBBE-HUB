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

// Following appears with the object layer's switch (no separate switch exists).
const setSwitch = (on: boolean) =>
  sql(`update feature_flag set enabled = ${on} where key = 'wos_objects' and organization_id is null`);

/**
 * Following (V1-14): the owner follows a project and a saved search, sets how
 * status changes reach them, and unfollows. The email choice lands where the
 * existing digest reads it.
 */
test("follow a project and a search, set a rule, and unfollow", async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const projectName = `Followed project ${stamp}`;
  const ownerId = sql(`select id from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id from organization_membership where user_id = '${ownerId}' limit 1`);
  const projectId = sql(
    `insert into project (organization_id, name, created_by) values ('${orgId}', '${projectName}', '${ownerId}') returning id`,
  );
  setSwitch(false);
  try {
    await signIn(page, "owner");
    await page.goto("/following");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();

    setSwitch(true);
    await page.goto(`/following?follow=${projectId}&type=project`);
    await expect(page.getByRole("heading", { name: `Follow ${projectName}?` })).toBeVisible();
    expect(await axeProblems(page), "following page accessibility").toEqual([]);
    await page.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(page.getByRole("button", { name: `Unfollow ${projectName}` })).toBeVisible({ timeout: 20_000 });

    // Keyboard: choose a saved search, Tab to its button and press Enter.
    const search = page.getByLabel("Saved search", { exact: true });
    await search.selectOption({ label: "Tasks I asked for" });
    await search.press("Tab");
    await expect(page.getByRole("button", { name: "Follow this search" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Unfollow Tasks I asked for" })).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("Status changes").selectOption({ label: "In the Hub and by email right away" });
    await page.getByRole("button", { name: "Save my rules" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your rules are saved." })).toBeVisible();
    expect(sql(`select category_modes->>'follow_status' from notification_preference where user_id = '${ownerId}'`)).toBe(
      "immediate",
    );

    await page.getByRole("button", { name: `Unfollow ${projectName}` }).click();
    await expect(page.getByRole("button", { name: `Unfollow ${projectName}` })).toHaveCount(0, { timeout: 20_000 });

    sql(`update user_profile set locale = 'fr-CA' where id = '${ownerId}'`);
    await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.goto("/following");
    await expect(page.getByRole("heading", { name: "Suivis", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Changements de statut")).toHaveValue("immediate");
    expect(await axeProblems(page), "French following page accessibility").toEqual([]);
  } finally {
    setSwitch(false);
    sql(`update user_profile set locale = null where id = '${ownerId}'`);
    sql(`delete from follow_rule_v2 where user_id = '${ownerId}'`);
    sql(`delete from follow_v2 where user_id = '${ownerId}'`);
    sql(`delete from project where id = '${projectId}'`);
  }
});
