import { expect, test } from "./fixtures";
import { currentTotp, signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Year-end and the external accountant (#154). The owner sees the statements,
 * year-end package and returns checklist, and the importable exports; then
 * grants the QA Guest time-limited accountant access. The Guest opens the
 * books from Home, is made to set up MFA first, reads the ledger and exports
 * it, and can change nothing. Revoking the grant closes the books again.
 *
 * Closing a fiscal year is not exercised here: it is permanent on the shared
 * QA database and would freeze the months other ledger specs post into. The
 * database suite (supabase/tests/year-end.sql) covers close and reopen.
 */
test("statements, exports and the accountant's read-only access", async ({ page }) => {
  test.setTimeout(240_000);
  const guestId = sql(`select id::text from user_profile where email = 'qa-guest@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${guestId}' limit 1`);
  // Start clean: no earlier grant, and no authenticator whose secret this run does not know.
  sql(`update ledger_accountant_grant set revoked_at = now() where user_id = '${guestId}' and revoked_at is null`);
  sql(`delete from auth.mfa_factors where user_id = '${guestId}'`);
  // The fiscal year the other ledger spec uses, so there is a year to show.
  sql(`insert into ledger_period (organization_id, name, starts_on, ends_on)
       select '${orgId}', to_char(m, 'YYYY-MM'), m::date, (m + interval '1 month' - interval '1 day')::date
       from generate_series(date '2026-10-01', date '2027-09-01', interval '1 month') as m
       where not exists (select 1 from ledger_period p where p.organization_id = '${orgId}' and p.starts_on = m::date)`);

  try {
    await signIn(page, "owner");

    await page.goto("/finance/ledger/statements?year=2026-10-01");
    await expect(page.getByRole("heading", { name: "Financial statements", exact: true })).toBeVisible();
    await expect(page.getByText("Prepared for your accountant, not filed.")).toBeVisible();

    await page.goto("/finance/ledger/year-end?year=2026-10-01");
    await expect(page.getByRole("heading", { name: "Fiscal years" })).toBeVisible();
    await expect(page.getByRole("link", { name: "General ledger for the year (import CSV)" })).toBeVisible();

    await page.goto("/finance/ledger/returns?year=2026-10-01");
    for (const form of ["T2", "T1044", "CO-17", "TP-997.1"]) {
      await expect(page.getByRole("heading", { name: new RegExp(`^${form.replace(".", "\\.")} ·`) })).toBeVisible();
    }
    await expect(page.getByText("Needs accountant review").first()).toBeVisible();

    const journal = await page.request.get("/api/finance/ledger/export/journal?from=2026-10-01&to=2027-09-30");
    expect(journal.status()).toBe(200);
    expect((await journal.text()).replace(/^﻿/, "").split("\r\n")[0]).toBe(
      "Date,Entry no,Account code,Account name,Fund,Program,Description,Debit,Credit",
    );
    const position = await page.request.get("/api/finance/ledger/statements?year=2026-10-01&statement=position");
    expect(position.status()).toBe(200);
    expect(await position.text()).toContain("Prepared for your accountant, not filed");

    // Grant the invited Guest access for ninety days.
    await page.goto("/finance/ledger/accountant");
    await page.getByLabel("Accountant", { exact: true }).selectOption({ label: "QA Guest (qa-guest@example.com)" });
    await clickWhenInteractive(page.getByRole("button", { name: "Grant access" }));
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 20_000 });
    await signOut(page);

    // The accountant opens the books from Home and must set up MFA first.
    await signIn(page, "guest");
    await clickWhenInteractive(page.getByRole("link", { name: /Open the books/ }));
    await expect(page.getByRole("heading", { name: "Protect your accountant access" })).toBeVisible({ timeout: 20_000 });
    const secret = await page.getByLabel("Can’t scan the QR code?", { exact: true }).inputValue();
    const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (secondsRemaining <= 2) await page.waitForTimeout((secondsRemaining + 1) * 1000);
    await page.getByLabel("Six-digit code", { exact: true }).fill(currentTotp(secret));
    await clickWhenInteractive(page.getByRole("button", { name: "Enable MFA" }));
    await page.waitForURL((url) => url.pathname === "/finance/ledger", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();

    // Reads and exports, changes nothing.
    await page.goto("/finance/ledger/journal");
    await expect(page.getByRole("link", { name: "New entry" })).toHaveCount(0);
    await page.goto("/finance/ledger/statements?year=2026-10-01");
    await expect(page.getByText("Prepared for your accountant, not filed.")).toBeVisible();
    await page.goto("/finance/ledger/year-end");
    await expect(page.getByRole("button", { name: /^Close fiscal year/ })).toHaveCount(0);
    await page.goto("/finance/ledger/accountant");
    await expect(page.getByText("You do not have access to the ledger")).toBeVisible();
    expect((await page.request.get("/api/finance/ledger/export/journal?from=2026-10-01&to=2027-09-30")).status()).toBe(200);

    // The rest of the workspace stays closed to a Guest.
    await page.goto("/crm");
    await page.waitForURL((url) => url.pathname === "/");

    const signIns = sql(`select count(*) from audit_event where actor_id = '${guestId}' and action = 'accountant_signed_in'`);
    expect(Number(signIns), "the accountant's sign-in is audited").toBeGreaterThan(0);
    const exports = sql(`select count(*) from audit_event where actor_id = '${guestId}' and action = 'journal_import_exported'`);
    expect(Number(exports), "the accountant's export is audited").toBeGreaterThan(0);

    // Revoking closes the books at once.
    sql(`update ledger_accountant_grant set revoked_at = now() where user_id = '${guestId}' and revoked_at is null`);
    await page.goto("/finance/ledger");
    await page.waitForURL((url) => url.pathname === "/");
    expect((await page.request.get("/api/finance/ledger/export/journal")).status()).toBe(403);
  } finally {
    sql(`update ledger_accountant_grant set revoked_at = now() where user_id = '${guestId}' and revoked_at is null`);
    sql(`delete from auth.mfa_factors where user_id = '${guestId}'`);
  }
});
