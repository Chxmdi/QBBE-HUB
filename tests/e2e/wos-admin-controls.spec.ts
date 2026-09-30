import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Admin controls (V2-9, epic #199): sign-in rules per role, the audit log
 * export and the "what can this role see" report. Behind `wos_spaces`,
 * turned on for these tests only.
 */

function setSwitch(enabled: boolean) {
  sql(`update feature_flag set enabled = ${enabled} where key = 'wos_spaces' and organization_id is null`);
}

test.describe("admin controls", () => {
  test.afterEach(() => setSwitch(false));

  test("staff are sent away", async ({ page }) => {
    setSwitch(true);
    await signIn(page, "staff");
    await page.goto("/spaces/admin");
    await expect(page).toHaveURL(/\/\?denied=1$/);
  });

  test("an admin sets a rule, reads the role report and downloads the audit log", async ({ page }) => {
    test.setTimeout(120_000);
    setSwitch(true);
    const orgId = sql(
      `select organization_id::text from organization_membership m join user_profile p on p.id = m.user_id where p.email = 'qa-admin@example.com'`,
    );
    try {
      await signIn(page, "admin");
      await page.goto("/spaces/admin");
      await expect(page.getByRole("heading", { name: "Access and sign-in", level: 1 })).toBeVisible();

      // Owners' and admins' two-step sign-in cannot be switched off.
      await expect(page.getByRole("checkbox", { name: "Always on for this role" }).first()).toBeDisabled();

      // Staff: require two-step sign-in and 8-hour sessions, by keyboard.
      const staff = page.locator("form").filter({ has: page.getByText("Staff", { exact: true }) });
      await staff.getByRole("checkbox", { name: "Require two-step sign-in" }).focus();
      await page.keyboard.press("Space");
      await staff.getByLabel("Sign in again after (hours)").fill("8");
      await staff.getByRole("button", { name: "Save" }).focus();
      await page.keyboard.press("Enter");
      await expect(staff.getByRole("status")).toHaveText("Saved.");
      expect(sql(`select require_mfa::text || ',' || max_session_hours from sign_in_rule where organization_id = '${orgId}' and role = 'staff'`))
        .toBe("true,8");

      // A bad value is refused with a message.
      await staff.getByLabel("Sign in again after (hours)").fill("900");
      await staff.getByRole("button", { name: "Save" }).click();
      await expect(staff.getByRole("alert")).toHaveText("Hours must be a whole number from 1 to 720, or empty.");

      // The role report.
      await page.getByLabel("Role", { exact: true }).selectOption("leadership_viewer");
      await page.getByRole("button", { name: "Show" }).click();
      const report = page.getByRole("region", { name: "What can this role see" });
      await expect(report.getByText(/^Tasks: (\d+) of \1$/)).toBeVisible();

      const axe = await new AxeBuilder({ page }).analyze();
      const serious = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

      // The audit log export, which records itself.
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download CSV" }).click(),
      ]);
      const csv = await readFile((await download.path())!, "utf8");
      expect(csv.split("\r\n")[0]).toBe('"created_at","actor_id","actor_type","event_type","action","result","object_type","object_id","metadata"');
      expect(csv).toContain("sign_in_rule_changed");
      expect(Number(sql(`select count(*) from audit_event where organization_id = '${orgId}' and action = 'audit_log_exported'`)))
        .toBeGreaterThan(0);
    } finally {
      sql(`update sign_in_rule set require_mfa = false, max_session_hours = null where organization_id = '${orgId}' and role = 'staff'`);
    }
  });

  test("the screen reads in French", async ({ page }) => {
    setSwitch(true);
    await signIn(page, "admin");
    const origin = new URL(page.url()).origin;
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
    await page.goto("/spaces/admin");
    await expect(page.getByRole("heading", { name: "Accès et connexion", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ce que ce rôle peut voir" })).toContainText("Tâches :");
    await page.context().clearCookies({ name: "qbbe-locale" });
  });
});
