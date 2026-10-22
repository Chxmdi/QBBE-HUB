import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Admin > Integrations shows Zeffy honestly: "not set up" while the
 * environment has no ZEFFY_API_KEY (CI), the connection's real state once one
 * exists, the webhook's state, and Disconnect that keeps what was copied.
 * The connect-and-sync path against Zeffy itself is exercised with
 * scripts/qa/zeffy-mock.mjs (docs/runbooks/integrations.md).
 */
test("Admin shows the Zeffy integration, its state, and disconnects it without losing data", async ({ page }) => {
  test.setTimeout(120_000);
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`);
  sql(`delete from integration_connection where provider = 'zeffy'`);
  sql(`delete from zeffy_sync_state where organization_id = '${orgId}'`);

  await signIn(page, "owner");
  await page.goto("/admin");
  const card = page.locator("div.card").filter({ has: page.getByText("Zeffy", { exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.getByText("Not connected")).toBeVisible();
  const connect = card.getByRole("button", { name: "Connect" });
  if (process.env.ZEFFY_API_KEY) {
    await expect(connect).toBeEnabled();
  } else {
    await expect(connect).toBeDisabled();
    await expect(card.getByText(/Set ZEFFY_API_KEY/)).toBeVisible();
  }

  // A connection the sync found delayed, mid first copy, with a payment kept.
  sql(`insert into integration_connection (organization_id, user_id, provider, status, last_sync_at, last_error)
       values ('${orgId}', null, 'zeffy', 'synchronization_delayed', now() - interval '20 minutes', 'Zeffy request timed out.')`);
  sql(`insert into zeffy_payment (organization_id, zeffy_id, paid_at, amount_cents, currency, status)
       values ('${orgId}', 'e2e-admin-kept', now(), 1000, 'cad', 'succeeded')
       on conflict (organization_id, zeffy_id) do nothing`);
  await page.reload();
  await expect(card.getByText("Synchronization delayed")).toBeVisible();
  await expect(card.getByText("Zeffy request timed out.")).toBeVisible();
  await expect(card.getByText(/First copy from Zeffy in progress/)).toBeVisible();
  await expect(
    card.getByText(process.env.ZEFFY_WEBHOOK_SECRET ? "No webhook received yet" : /Webhook not set up/),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Sync now" })).toBeVisible();

  await clickWhenInteractive(card.getByRole("button", { name: "Disconnect" }));
  await expect(card.getByText("Not connected")).toBeVisible();
  expect(sql(`select status from integration_connection where provider = 'zeffy' and organization_id = '${orgId}'`)).toBe(
    "disconnected",
  );
  // Payments are donor financial records: disconnecting keeps them.
  expect(sql(`select count(*) from zeffy_payment where zeffy_id = 'e2e-admin-kept'`)).toBe("1");
  expect(
    sql(`select count(*) from audit_event where organization_id = '${orgId}' and action = 'integration_disconnected'
         and metadata->>'provider' = 'zeffy'`),
  ).not.toBe("0");
});
