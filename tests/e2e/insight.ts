import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { sql } from "./db";

/**
 * Shared steps for the Insight specs (graph and map lenses, dashboards and
 * analytics). Insight sits behind the `wos_lenses` switch, so each spec turns
 * it on for its own run and puts back what it found.
 */

export function setLensesSwitch(enabled: boolean): boolean {
  const before = sql(`select enabled from feature_flag where key = 'wos_lenses' and organization_id is null`) === "t";
  sql(`update feature_flag set enabled = ${enabled} where key = 'wos_lenses' and organization_id is null`);
  return before;
}

export function qaIds(): { ownerId: string; orgId: string } {
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(
    `select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`,
  );
  return { ownerId, orgId };
}

/** Axe in both themes; any violation fails, not only serious ones. */
export async function expectAccessible(page: Page) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("qbbe-theme", value);
      document.documentElement.classList.toggle("dark", value === "dark");
    }, theme);
    await page.waitForTimeout(200);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations, `${theme} theme: ${JSON.stringify(result.violations, null, 1)}`).toEqual([]);
  }
}
