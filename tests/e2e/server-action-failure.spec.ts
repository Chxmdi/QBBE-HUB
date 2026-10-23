import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * A save whose request never reaches the server must not leave its button
 * stuck on "Saving…" with nothing said (useServerAction). The request is
 * aborted in the browser, as a dropped connection would.
 */
test("a create that cannot reach the Hub re-enables its button and says why", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/projects");
  await clickWhenInteractive(page.getByRole("button", { name: "New project" }));
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(`Unreachable ${Date.now()}`);

  // Server actions are POSTs that carry a Next-Action header.
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.abort("internetdisconnected")
      : route.continue(),
  );
  const create = dialog.getByRole("button", { name: "Create project" });
  await create.click();

  await expect(dialog.getByText("Could not reach the Hub. Check your connection, then try again.")).toBeVisible();
  await expect(create).toBeEnabled();
});

/** Server actions are POSTs that carry a Next-Action header; drop them, as a lost connection would. */
async function dropServerActions(page: Page) {
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.abort("internetdisconnected")
      : route.continue(),
  );
}

function qaOrganization(): string {
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  return sql(`select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`);
}

test("recording a gift that cannot reach the Hub re-enables the button and says why", async ({ page }) => {
  const donor = `Unreachable Donor ${Date.now()}`;
  sql(`insert into crm_contact (organization_id, full_name) values ('${qaOrganization()}', '${donor}')`);
  await signIn(page, "owner");
  await page.goto("/finance/gifts");
  await clickWhenInteractive(page.getByRole("button", { name: "Record a gift" }));
  const dialog = page.getByRole("dialog", { name: "Record a gift" });
  await dialog.getByLabel("Date received").fill("2026-10-15");
  await dialog.getByLabel("Donor", { exact: true }).selectOption({ label: donor });
  await dialog.getByLabel("Amount received").fill("125.00");
  await expect(dialog.getByLabel("Debit")).toHaveValue(/.+/);

  await dropServerActions(page);
  const record = dialog.getByRole("button", { name: "Record and post" });
  await record.click();

  await expect(dialog.getByText("Could not reach the Hub. Check your connection, then try again.")).toBeVisible();
  await expect(record).toBeEnabled();
});

test("saving a bill that cannot reach the Hub re-enables the button and says why", async ({ page }) => {
  const vendor = `Unreachable Vendor ${Date.now()}`;
  sql(`insert into finance_contact (organization_id, name, is_vendor) values ('${qaOrganization()}', '${vendor}', true)`);
  await signIn(page, "owner");
  await page.goto("/finance/payables/bills/new");
  await page.getByLabel("Vendor", { exact: true }).selectOption({ label: vendor });
  await page.getByLabel("Vendor invoice number").fill(`U-${Date.now()}`);
  await page.getByLabel("Bill date").fill("2026-10-05");
  await page.getByLabel("Due date").fill("2026-11-04");
  const line = page.getByRole("group", { name: "Line 1" });
  await line.getByLabel("Expense or asset account").selectOption({ label: "5300 Office supplies" });
  await line.getByLabel("Amount before tax").fill("200.00");

  await dropServerActions(page);
  const save = page.getByRole("button", { name: "Save draft" });
  await save.click();

  await expect(page.getByText("Could not reach the Hub. Check your connection, then try again.")).toBeVisible();
  await expect(save).toBeEnabled();
});

test("a message that cannot reach the Hub keeps its text, re-enables Send and says why", async ({ page }) => {
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const channelId = sql(
    `select c.id::text from channel c join channel_member m on m.channel_id = c.id
     where m.user_id = '${ownerId}' and c.archived_at is null order by c.created_at limit 1`,
  );
  await signIn(page, "owner");
  await page.goto(`/channels/${channelId}`);
  const composer = page.getByRole("textbox", { name: "Write a message…" });
  const text = `Unreachable message ${Date.now()}`;
  await composer.fill(text);

  await dropServerActions(page);
  const send = page.getByRole("button", { name: "Send message" });
  await clickWhenInteractive(send);

  await expect(page.getByText("Could not reach the Hub. Check your connection, then try again.")).toBeVisible();
  await expect(composer).toHaveValue(text);
  await expect(send).toBeEnabled();
});
