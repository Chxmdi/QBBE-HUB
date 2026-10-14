import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * The supporter CRM fed by Zeffy: staff see who supports QBBE and what they
 * took part in, never how much; finance readers (the owner here) also see
 * amounts, receipts and the overview's money, and their views and exports are
 * recorded. Staff place a Zeffy supporter the sync could not match. The data
 * is written straight into the tables the Zeffy sync fills, so no Zeffy
 * account is needed; each run uses unique ids.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).include("main").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

function seed() {
  const run = Date.now().toString(36);
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${staffId}' limit 1`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);
  sql(`update user_profile set locale = 'en' where id = '${staffId}'`);
  sql(`delete from integration_connection where provider = 'zeffy'`);
  sql(`insert into integration_connection (organization_id, user_id, provider, status, last_sync_at)
       values ('${orgId}', null, 'zeffy', 'connected', now() - interval '5 minutes')`);

  const donor = `Zeffy Donor ${run}`;
  const zeffyContact = `e2e-zc-${run}`;
  const gala = `e2e-gala-${run}`;
  const galaTitle = `Spring Gala ${run}`;
  sql(`insert into zeffy_campaign (organization_id, zeffy_id, category, status, title, url, goal_cents, raised_cents, currency, starts_at)
       values ('${orgId}', '${gala}', 'event', 'active', '${galaTitle}', 'https://www.zeffy.com/en-CA/ticketing/${gala}',
               500000, 125000, 'cad', now() + interval '1 year')`);
  const donorId = sql(`insert into crm_contact (organization_id, full_name, email, source, zeffy_contact_id, zeffy_kinds, zeffy_last_activity_at)
       values ('${orgId}', '${donor}', 'donor-${run}@example.com', 'zeffy', '${zeffyContact}', '{donor,ticket}', now())
       returning id::text`);
  sql(`insert into zeffy_payment (organization_id, zeffy_id, zeffy_contact_id, zeffy_campaign_id, campaign_title, campaign_category,
         paid_at, amount_cents, currency, status, item_kinds, items, receipt_url)
       values
       ('${orgId}', 'e2e-pay-d-${run}', '${zeffyContact}', 'e2e-form-${run}', 'Annual appeal ${run}', 'donation',
        now() - interval '2 days', 5000, 'cad', 'succeeded', '{donor}', '[{"type":"donation","amount":5000}]',
        'https://www.zeffy.com/receipt/e2e-${run}'),
       ('${orgId}', 'e2e-pay-t-${run}', '${zeffyContact}', '${gala}', '${galaTitle}', 'event',
        now() - interval '1 day', 2500, 'cad', 'succeeded', '{ticket}', '[{"type":"ticket","amount":2500}]', null)`);

  // Two Hub contacts share an email, so the sync left this Zeffy buyer for staff.
  const twinEmail = `twin-${run}@example.com`;
  const twinA = sql(`insert into crm_contact (organization_id, full_name, email) values ('${orgId}', 'Twin A ${run}', '${twinEmail}') returning id::text`);
  const twinB = sql(`insert into crm_contact (organization_id, full_name, email) values ('${orgId}', 'Twin B ${run}', '${twinEmail}') returning id::text`);
  const matchZeffy = `e2e-match-${run}`;
  sql(`insert into zeffy_contact_match (organization_id, zeffy_contact_id, full_name, email, candidate_ids)
       values ('${orgId}', '${matchZeffy}', 'Twin Buyer ${run}', '${twinEmail}', array['${twinA}', '${twinB}']::uuid[])`);
  sql(`insert into zeffy_payment (organization_id, zeffy_id, zeffy_contact_id, campaign_title, campaign_category,
         paid_at, amount_cents, currency, status, item_kinds)
       values ('${orgId}', 'e2e-pay-m-${run}', '${matchZeffy}', 'Annual appeal ${run}', 'donation',
               now() - interval '3 days', 1000, 'cad', 'succeeded', '{donor}')`);
  return { run, orgId, staffId, donor, donorId, galaTitle, twinA, matchZeffy };
}

test("staff see supporters and Zeffy activity without amounts, and place an unmatched supporter", async ({ page }) => {
  test.setTimeout(180_000);
  const data = seed();

  await signIn(page, "staff");
  await page.goto(`/crm/supporters?q=${encodeURIComponent(data.donor)}`);
  await expect(page.getByRole("heading", { name: "Supporters", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Supporters" })).toHaveAttribute("aria-current", "page");
  const row = page.getByRole("row").filter({ hasText: data.donor });
  await expect(row.getByText("Donor", { exact: true })).toBeVisible();
  await expect(row.getByText("Ticket buyer", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Given (net)" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Export giving (CSV)" })).toHaveCount(0);
  await expectNoSeriousAxe(page);

  // Filters: the donor is a ticket buyer, not a member.
  await page.getByLabel("Activity").selectOption({ label: "Member" });
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("No supporters match", { exact: true })).toBeVisible();
  await page.getByLabel("Activity").selectOption({ label: "Ticket buyer" });
  await page.getByRole("button", { name: "Filter" }).click();
  await clickWhenInteractive(page.getByRole("link", { name: data.donor }));

  await expect(page).toHaveURL(new RegExp(`/crm/contacts/${data.donorId}$`));
  await expect(page.getByRole("heading", { name: data.donor, level: 1 })).toBeVisible();
  const activity = page.getByRole("region", { name: "Zeffy activity" });
  await expect(activity.getByText(data.galaTitle)).toBeVisible();
  await expect(activity.getByText(`Annual appeal ${data.run}`)).toBeVisible();
  await expect(activity.getByRole("columnheader", { name: "Amount" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tax receipt" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Giving" })).toHaveCount(0);
  await expectNoSeriousAxe(page);

  // Staff record an interaction with the supporter.
  await clickWhenInteractive(page.getByRole("button", { name: "Record an interaction" }));
  const dialog = page.getByRole("dialog", { name: "Record an interaction" });
  await dialog.getByLabel("Type").selectOption({ label: "call" });
  await dialog.getByLabel("What happened").fill(`Thanked for the gala ${data.run}`);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`Thanked for the gala ${data.run}`)).toBeVisible();

  // Overview: campaigns, attendance and the matching list; no money.
  await page.goto("/crm/zeffy");
  await expect(page.getByRole("heading", { name: "Zeffy", level: 1 })).toBeVisible();
  await expect(page.getByText(/Last copied from Zeffy/)).toBeVisible();
  await expect(page.getByRole("link", { name: `Open ${data.galaTitle} in Zeffy` })).toHaveAttribute(
    "href",
    /^https:\/\/www\.zeffy\.com\//,
  );
  await expect(page.getByRole("progressbar", { name: data.galaTitle })).toHaveAttribute("aria-valuenow", "25");
  const attendance = page.getByRole("region", { name: "Attendance in the period" });
  await expect(attendance.getByRole("row").filter({ hasText: data.galaTitle })).toContainText("1 ticket");
  await expect(page.getByText("Raised in the period (net)")).toHaveCount(0);
  await expectNoSeriousAxe(page);

  const matching = page.getByRole("region", { name: "Needs matching" });
  const item = matching.getByRole("listitem").filter({ hasText: `Twin Buyer ${data.run}` });
  await clickWhenInteractive(item.getByRole("button", { name: `This is Twin A ${data.run}` }));
  await expect(item).toHaveCount(0);
  expect(sql(`select zeffy_contact_id from crm_contact where id = '${data.twinA}'`)).toBe(data.matchZeffy);
  expect(sql(`select zeffy_kinds::text from crm_contact where id = '${data.twinA}'`)).toBe("{donor}");
  expect(
    sql(`select count(*) from audit_event where organization_id = '${data.orgId}' and action = 'supporter_matched'
         and object_id = '${data.twinA}'`),
  ).toBe("1");
  await signOut(page);
});

test("finance readers see amounts, receipts and money, and the export is recorded", async ({ page }) => {
  test.setTimeout(180_000);
  const data = seed();
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);

  await signIn(page, "owner");
  await page.goto(`/crm/supporters?q=${encodeURIComponent(data.donor)}`);
  const row = page.getByRole("row").filter({ hasText: data.donor });
  await expect(page.getByRole("columnheader", { name: "Given (net)" })).toBeVisible();
  await expect(row).toContainText("75.00");

  const exportLink = page.getByRole("link", { name: "Export giving (CSV)" });
  const response = await page.request.get((await exportLink.getAttribute("href")) ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const csv = await response.text();
  expect(csv.split("\r\n")[0]).toContain("Given (net)");
  expect(csv).toContain(`${data.donor},donor-${data.run}@example.com,Donor; Ticket buyer,,CAD,75.00,`);
  expect(
    sql(`select count(*) from audit_event where organization_id = '${data.orgId}' and actor_id = '${ownerId}'
         and action = 'supporter_list_exported' and created_at > now() - interval '5 minutes'`),
  ).not.toBe("0");

  await page.goto(`/crm/contacts/${data.donorId}`);
  const activity = page.getByRole("region", { name: "Zeffy activity" });
  await expect(activity.getByRole("columnheader", { name: "Amount" })).toBeVisible();
  await expect(activity.getByRole("row").filter({ hasText: `Annual appeal ${data.run}` })).toContainText("50.00");
  await expect(activity.getByRole("link", { name: "Tax receipt" })).toHaveAttribute(
    "href",
    `https://www.zeffy.com/receipt/e2e-${data.run}`,
  );
  await expect(page.getByRole("region", { name: "Giving" })).toContainText("75.00");
  await expectNoSeriousAxe(page);

  await page.goto("/crm/zeffy?period=90");
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("90");
  await expect(page.getByText("Raised in the period (net)")).toBeVisible();
  await expect(page.getByText("Raised by kind of campaign")).toBeVisible();
  await expectNoSeriousAxe(page);
  await signOut(page);
});

test.describe("in French at phone width", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("staff read the supporter screens in French without sideways scrolling", async ({ page }) => {
    test.setTimeout(180_000);
    const data = seed();
    sql(`update user_profile set locale = 'fr-CA' where id = '${data.staffId}'`);
    try {
      await signIn(page, "staff");
      await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
      for (const [path, heading] of [
        ["/crm/supporters", "Sympathisants"],
        [`/crm/contacts/${data.donorId}`, data.donor],
        ["/crm/zeffy", "Zeffy"],
      ] as const) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
      }
      await expect(page.getByRole("heading", { name: "À jumeler" })).toBeVisible();
    } finally {
      sql(`update user_profile set locale = 'en' where id = '${data.staffId}'`);
      await page.context().clearCookies({ name: "qbbe-locale" });
    }
  });
});
