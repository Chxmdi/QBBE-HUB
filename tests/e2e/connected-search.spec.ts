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
 * Search across connected apps (V2-6). CI never reaches Google, so the browser
 * test covers the path a person without their own Google connection takes:
 * the search runs, and each service says it is not connected for them rather
 * than showing anyone else's results. Results from Google are covered by the
 * unit tests with Google's responses mocked (connected-search.test.ts).
 */
test("searching Drive and Gmail uses only the person's own connections", async ({ page }) => {
  test.setTimeout(120_000);
  const ownerId = sql(`select id from user_profile where email = 'qa-staff@example.com'`);
  sql(`delete from integration_connection where user_id = '${ownerId}' and provider in ('gmail', 'google_drive')`);
  setSwitch(true);
  try {
    await signIn(page, "staff");
    await page.goto("/google/search");
    await expect(page.getByRole("heading", { name: "Find in Drive and Gmail", level: 1 })).toBeVisible();
    const box = page.getByRole("searchbox", { name: "Search for" });
    await box.fill("budget");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/google\/search\?q=budget$/);
    await expect(page.getByText("Google Drive is not connected for you.", { exact: false })).toBeVisible();
    await expect(page.getByText("Gmail is not connected for you.", { exact: false })).toBeVisible();
    expect(await axeProblems(page), "search accessibility").toEqual([]);
  } finally {
    setSwitch(false);
  }
});
