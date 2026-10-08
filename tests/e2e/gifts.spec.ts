import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Gifts and acknowledgements (#156): the owner records a donation for a CRM
 * contact, which posts a linked ledger entry; issues a thank-you letter whose
 * printable HTML carries the bilingual "not an official receipt" sentence;
 * sees the donor list and exports it, and the export is audited. Staff who
 * are not ledger readers see nothing. Gifts are permanent by design, so each
 * run uses a unique donor rather than cleaning up.
 */
test("the owner records a gift, posts it and issues a bilingual not-a-receipt acknowledgement", async ({ page }) => {
  test.setTimeout(240_000);
  const donor = `Gift Donor ${Date.now()}`;
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${staffId}' limit 1`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);

  // The books must be open for the gift's date: the accountant's approval and
  // periods covering 15 September 2026. The fiscal year starts in October,
  // so this is the whole year ending that month: fiscal years are counted
  // from the earliest period, and a lone September period would move every
  // year the other ledger specs use (2026-10-01 to 2027-09-30) to September.
  sql(`update ledger_settings set chart_approved_on = '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
         chart_approval_recorded_at = now() where organization_id = '${orgId}' and chart_approved_on is null`);
  sql(`insert into ledger_period (organization_id, name, starts_on, ends_on)
       select '${orgId}', to_char(m, 'YYYY-MM'), m::date, (m + interval '1 month' - interval '1 day')::date
       from generate_series(date '2025-10-01', date '2026-09-01', interval '1 month') as m
       where not exists (select 1 from ledger_period p where p.organization_id = '${orgId}'
                          and p.starts_on <= (m + interval '1 month' - interval '1 day')::date and m::date <= p.ends_on)`);
  sql(`insert into crm_contact (organization_id, full_name, email) values ('${orgId}', '${donor}', 'gift-donor@example.com')`);

  await signIn(page, "owner");
  await page.goto("/finance/gifts");
  await expect(page.getByRole("heading", { name: "Gifts and grants", exact: true })).toBeVisible();
  await expect(page.getByText("It cannot issue official tax receipts.")).toBeVisible();

  await clickWhenInteractive(page.getByRole("button", { name: "Record a gift" }));
  const dialog = page.getByRole("dialog", { name: "Record a gift" });
  await dialog.getByLabel("Date received").fill("2026-09-15");
  await dialog.getByLabel("Donor", { exact: true }).selectOption({ label: donor });
  await dialog.getByLabel("Amount received").fill("125.00");
  await expect(dialog.getByLabel("Debit")).toHaveValue(/.+/);
  await clickWhenInteractive(dialog.getByRole("button", { name: "Record and post" }));

  await expect(page.getByRole("heading", { name: /^Gift \d+$/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("$125.00")).toBeVisible();
  const entryLink = page.getByRole("link", { name: /^Entry \d+$/ });
  await expect(entryLink).toBeVisible();

  // The acknowledgement: French, printed. It opens in a new tab.
  const popup = page.waitForEvent("popup");
  await page.getByLabel("Language").selectOption("fr");
  await clickWhenInteractive(page.getByRole("button", { name: "Issue thank-you letter" }));
  await (await popup).close();
  const view = page.getByRole("link", { name: "View and print" }).first();
  await expect(view).toBeVisible({ timeout: 20_000 });
  const href = await view.getAttribute("href");
  const letter = await page.request.get(href!);
  expect(letter.status()).toBe(200);
  const html = await letter.text();
  expect(html).toContain("This is not an official donation receipt for income tax purposes.");
  expect(html).toContain("Ceci n&#39;est pas un reçu officiel de don aux fins de l&#39;impôt.");
  expect(html).toContain(donor);
  expect(html).toMatch(/125,00\s\$/);
  expect(html).not.toMatch(/<script/i);

  // The ledger entry points back to the gift.
  await entryLink.click();
  await expect(page.getByRole("heading", { name: /^Entry \d+$/ })).toBeVisible();

  // The donor list shows the donor; exporting it is audited.
  await page.goto("/finance/gifts/donors?from=2026-09-01&to=2026-09-30");
  await expect(page.getByRole("cell", { name: new RegExp(donor) })).toBeVisible();
  const csv = await page.request.get("/api/finance/gifts/donors/export?from=2026-09-01&to=2026-09-30");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain(`${donor},Person,gift-donor@example.com,1,125.00`);
  expect(
    Number(sql(`select count(*) from audit_event where organization_id = '${orgId}' and action = 'donor_list_exported'
                and created_at > now() - interval '5 minutes'`)),
  ).toBeGreaterThan(0);
  await signOut(page);

  // Staff who are not ledger readers see no donors, on screen or by export.
  await signIn(page, "staff");
  await page.goto("/finance/gifts");
  await expect(page.getByText("You do not have access to the ledger")).toBeVisible();
  await expect(page.getByText(donor)).toHaveCount(0);
  expect((await page.request.get("/api/finance/gifts/donors/export?from=2026-09-01&to=2026-09-30")).status()).toBe(403);
  expect((await page.request.get(href!)).status()).toBe(404);
});

/** Year 0000 has no days, and Postgres refused it: both gift pages showed "Something went wrong". */
test("a year that does not exist shows the current year on the gift pages, not an error", async ({ page }) => {
  await signIn(page, "owner");
  for (const path of ["/finance/gifts?year=0000", "/finance/gifts/statement?year=0000"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Something went wrong" }), path).toHaveCount(0);
  }
});
