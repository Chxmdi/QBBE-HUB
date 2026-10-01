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
 * Google objects (V1-15). The synced rows the Google integration would store
 * are seeded directly, so nothing reaches Google: the owner turns a calendar
 * event into a meeting, sends a Gmail message to capture and links a Drive file.
 */
test("the Google page is hidden while the switch is off [switch off]", async ({ page }) => {
  setSwitch(false);
  await signIn(page, "owner");
  await page.goto("/google");
  await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
});

test("a calendar event becomes a meeting, mail goes to capture, a Drive file is linked", async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const eventTitle = `Partner call ${stamp}`;
  const subject = `Venue quote ${stamp}`;
  const fileName = `Budget sheet ${stamp}`;
  const ownerId = sql(`select id from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id from organization_membership where user_id = '${ownerId}' limit 1`);
  const connection = sql(
    `insert into integration_connection (organization_id, user_id, provider, status)
     values ('${orgId}', '${ownerId}', 'google_calendar', 'connected')
     on conflict (organization_id, provider, user_id) do update set status = 'connected' returning id`,
  );
  sql(`insert into calendar_event_link (organization_id, user_id, connection_id, external_id, title, starts_at)
       values ('${orgId}', '${ownerId}', '${connection}', 'e2e-${stamp}', '${eventTitle}', now() + interval '3 days')`);
  sql(`insert into gmail_message (organization_id, user_id, connection_id, external_id, subject, snippet, from_address, received_at)
       values ('${orgId}', '${ownerId}', '${connection}', 'e2e-${stamp}', '${subject}', 'The hall is free', 'venue@example.com', now())`);
  setSwitch(true);
  try {
    await signIn(page, "owner");
    await page.goto("/google");
    await expect(page.getByRole("heading", { name: "Google in the Hub", level: 1 })).toBeVisible();
    expect(await axeProblems(page), "Google page accessibility").toEqual([]);

    await page.getByRole("button", { name: `Add ${eventTitle} as a meeting` }).click();
    await expect(page.getByRole("status").filter({ hasText: `${eventTitle} is now a Hub meeting.` })).toBeVisible({ timeout: 20_000 });
    expect(sql(`select count(*) from meeting m join calendar_event_link l on l.meeting_id = m.id where l.external_id = 'e2e-${stamp}'`)).toBe("1");

    await page.getByRole("button", { name: `Send ${subject} to capture` }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sent to your capture inbox." })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: subject }).filter({ hasText: "venue@example.com" }).first()).toBeVisible();

    await page.getByLabel("Drive address").fill("https://example.com/not-drive");
    await page.getByLabel("Name in the Hub").fill(fileName);
    await page.getByRole("button", { name: "Link the file" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Paste a Google Drive" })).toBeVisible();
    await page.getByLabel("Drive address").fill("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlmnoPq/edit");
    await page.getByRole("button", { name: "Link the file" }).click();
    await expect(page.getByRole("status").filter({ hasText: "The file is linked." })).toBeVisible({ timeout: 20_000 });
    expect(sql(`select count(*) from document where title = '${fileName}'`)).toBe("1");

    sql(`update user_profile set locale = 'fr-CA' where id = '${ownerId}'`);
    await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.goto("/google");
    await expect(page.getByRole("heading", { name: "Google dans le Hub", level: 1 })).toBeVisible();
    expect(await axeProblems(page), "French Google page accessibility").toEqual([]);
  } finally {
    setSwitch(false);
    sql(`update user_profile set locale = null where id = '${ownerId}'`);
    sql(`delete from meeting where title = '${eventTitle}'`);
    sql(`delete from capture_forward where title = '${subject}'`);
    sql(`delete from document where title = '${fileName}'`);
    sql(`delete from gmail_message where external_id = 'e2e-${stamp}'`);
    sql(`delete from calendar_event_link where external_id = 'e2e-${stamp}'`);
  }
});
