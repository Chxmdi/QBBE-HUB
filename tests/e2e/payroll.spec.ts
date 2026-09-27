import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Payroll import (#155): the owner imports a fabricated Nethris journal
 * (per-employee lines with made-up names and SINs), sees one pay run, saves
 * an allocation, posts it as one balanced entry, imports the same file again
 * without adding anything, and reverses the run. Nothing about the fictive
 * employees reaches the database. Staff who do not read the ledger see no
 * payroll. Posted entries are permanent by design, so each run uses its own
 * far-future pay date.
 */
test("the owner imports a pay run, posts it once, and no employee detail is stored", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const year = 2100 + (Math.floor(stamp / 1000) % 7900);
  const payDate = `${year}-03-13`;
  const person = `Personne Fictive ${stamp}`;
  const reference = `E2E-${stamp}`;
  const orgId = sql(
    `select organization_id::text from organization_membership m join user_profile u on u.id = m.user_id
     where u.email = 'qa-owner@example.com' limit 1`,
  );
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);
  sql(`
    update ledger_settings set chart_approved_on = date '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
      chart_approval_recorded_at = coalesce(chart_approval_recorded_at, now())
    where organization_id = '${orgId}' and chart_approved_on is null;
    insert into ledger_period (organization_id, name, starts_on, ends_on)
    select '${orgId}', '${year}-03', date '${year}-03-01', date '${year}-03-31'
    where not exists (select 1 from ledger_period where organization_id = '${orgId}' and starts_on = date '${year}-03-01');
  `);

  const row = (who: string, sin: string) =>
    `${reference};${payDate};${year}-02-27;${year}-03-12;${who};${sin};2 000,00;180,00;220,00;120,00;26,40;9,88;10,00;120,00;36,96;13,84;33,00;25,00;1,20;1 433,72`;
  const journal = {
    name: "journal-de-paie.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "No de paie;Date de paie;Début de période;Fin de période;Employé;NAS;Salaire brut;Impôt fédéral;Impôt provincial;RRQ;AE;RQAP;Autres retenues;RRQ employeur;AE employeur;RQAP employeur;FSS;CNESST;CNT;Salaire net",
        row(`${person} Un`, "000 000 000"),
        row(`${person} Deux`, "000 000 001"),
      ].join("\n"),
    ),
  };
  page.on("dialog", (dialog) => void dialog.accept());

  await signIn(page, "owner");
  await page.goto("/finance/payroll");
  await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
  await expect(page.getByText(/have not yet been checked against a real export/)).toBeVisible();
  await page.getByLabel("Payroll provider").selectOption("nethris");
  await page.getByLabel("Payroll journal or register (CSV)").setInputFiles(journal);
  await expect(page.getByRole("heading", { name: "1 pay run found" })).toBeVisible();
  await expect(page.getByText(/2 lines were added into these totals and then discarded/)).toBeVisible();
  await clickWhenInteractive(page.getByRole("button", { name: "Import pay runs" }));
  await expect(page.getByRole("heading", { name: `Pay run of ${payDate}` })).toBeVisible({ timeout: 20_000 });
  const runUrl = page.url();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  // Review: the entry balances before anything is posted.
  const total = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Balanced", exact: true }) });
  expect((await total.getByRole("cell").allTextContents()).slice(-2)).toEqual(["$4,460.00", "$4,460.00"]);

  // All of it to the general fund, saved explicitly.
  await clickWhenInteractive(page.getByRole("button", { name: "Add share" }));
  await page.getByLabel("Share 1 fund").selectOption({ label: "GEN General fund" });
  await page.getByLabel("Share 1 %").fill("100");
  await clickWhenInteractive(page.getByRole("button", { name: "Save allocation" }));
  await expect(page.getByText("Allocation saved.")).toBeVisible({ timeout: 20_000 });

  await clickWhenInteractive(page.getByRole("button", { name: "Post to ledger" }));
  await expect(page.getByText("Posted", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /^Journal entry \d+$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Posted journal entry" })).toBeVisible();

  // The same file again adds nothing.
  await page.goto("/finance/payroll");
  await page.getByLabel("Payroll provider").selectOption("nethris");
  await page.getByLabel("Payroll journal or register (CSV)").setInputFiles(journal);
  await expect(page.getByRole("heading", { name: "1 pay run found" })).toBeVisible();
  await clickWhenInteractive(page.getByRole("button", { name: "Import pay runs" }));
  await expect(page.getByText("Already imported: nothing was added.")).toBeVisible({ timeout: 20_000 });
  expect(sql(`select count(*) from payroll_run where organization_id = '${orgId}' and run_reference = '${reference}'`)).toBe("1");

  // Nothing about the fictive employees is stored anywhere payroll writes.
  expect(
    sql(`select count(*) from payroll_run where row_to_json(payroll_run)::text like '%${stamp} Un%'
         or row_to_json(payroll_run)::text like '%000 000 00%'`),
  ).toBe("0");
  expect(
    sql(`select count(*) from audit_event where event_type = 'payroll'
         and (metadata::text like '%Fictive ${stamp}%' or metadata::text like '%000 000 00%')`),
  ).toBe("0");
  expect(sql(`select count(*) from journal_line where description like '%Fictive ${stamp}%'`)).toBe("0");

  // Reverse the run.
  await page.goto(runUrl);
  await clickWhenInteractive(page.getByRole("button", { name: "Reverse" }));
  await expect(page.getByText("Reversed", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /^Reversed by entry \d+$/ })).toBeVisible();
  await signOut(page);

  // Staff who do not read the ledger see no payroll.
  await signIn(page, "staff");
  await page.goto("/finance/payroll");
  await expect(page.getByText("You do not have access to payroll")).toBeVisible();
  await expect(page.getByLabel("Payroll journal or register (CSV)")).toHaveCount(0);
  await page.goto(runUrl);
  await expect(page.getByText("You do not have access to payroll")).toBeVisible();
});
