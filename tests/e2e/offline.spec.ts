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
  sql(`update feature_flag set enabled = ${on} where key = 'wos_offline' and organization_id is null`);

/**
 * Offline (V3-1): changes made with no connection are kept on the device and
 * sent when it returns; a field someone else changed later keeps their value
 * and shows yours for review; a page opened earlier can be read offline.
 */
test("offline changes sync when back online, with the overwritten value shown for review", async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const contested = `Offline contested ${stamp}`;
  const quiet = `Offline quiet ${stamp}`;
  const created = `Offline new ${stamp}`;
  const ownerId = sql(`select id from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id from organization_membership where user_id = '${ownerId}' limit 1`);
  for (const title of [contested, quiet]) {
    sql(`insert into task (organization_id, title, created_by, assignee_id, requester_id)
         values ('${orgId}', '${title}', '${ownerId}', '${ownerId}', '${ownerId}')`);
  }
  setSwitch(true);
  try {
    await signIn(page, "owner");
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "Work offline", level: 1 })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    expect(await axeProblems(page), "offline page accessibility").toEqual([]);
    // Opened online, so it can be read offline later. The first visit after the
    // worker takes control is the one it keeps.
    await page.goto("/my-work");
    await page.goto("/offline");
    await expect(page.getByLabel(`Status for ${contested}`)).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: "You are offline." })).toBeVisible();
    await page.getByLabel(`Status for ${contested}`).selectOption({ label: "In progress" });
    await page.getByLabel(`Priority for ${quiet}`).selectOption({ label: "High" });
    await page.getByLabel("Title of the new task").fill(created);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("3 changes waiting to be sent.")).toBeVisible();

    // Someone else finishes the contested task after the offline edit.
    sql(`update task set status = 'completed', completed_at = now(), updated_at = now() + interval '1 minute' where title = '${contested}'`);

    // A page opened earlier still reads offline.
    await page.goto("/my-work");
    await expect(page.locator("main")).toBeVisible();
    await page.goBack();
    await expect(page.getByText("3 changes waiting to be sent.")).toBeVisible();

    // The first send after reconnecting fails, as it can while a connection
    // settles; the page tries again on its own.
    let dropped = 0;
    await page.route("**/offline", (route) => {
      if (route.request().method() === "POST" && dropped === 0) {
        dropped += 1;
        return route.abort("internetdisconnected");
      }
      return route.fallback();
    });
    await context.setOffline(false);
    await expect(page.getByText("Nothing waiting to be sent.")).toBeVisible({ timeout: 30_000 });
    expect(dropped, "the first send was dropped").toBe(1);
    await expect(
      page.getByText(`A later change to status on “${contested}” was kept: Completed. Yours was In progress.`),
    ).toBeVisible();
    expect(sql(`select status::text from task where title = '${contested}'`)).toBe("completed");
    expect(sql(`select priority::text from task where title = '${quiet}'`)).toBe("high");
    expect(sql(`select count(*) from task where title = '${created}' and requester_id = '${ownerId}'`)).toBe("1");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("heading", { name: "Changes to review" })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    setSwitch(false);
    sql(`delete from task where title in ('${contested}', '${quiet}', '${created}')`);
  }
});
