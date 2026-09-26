import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Receipt capture (#142 v1). Who may do what is proved at the database in
 * `supabase/tests/finance-receipts.sql`; this settles what only a browser can:
 * a staff member photographs a receipt and it is saved with the right figures
 * and file, finance sees it and marks it reviewed, the CSV export carries it,
 * and a volunteer never reaches the screen.
 */

// A 1x1 PNG: enough for Storage to accept the upload as an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("staff submit a receipt; finance reviews and exports it", async ({ page }) => {
  test.setTimeout(240_000);
  const vendor = `Staples QA ${Date.now()}`;

  await signIn(page, "staff");
  await page.goto("/finance/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Submit receipt" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit a receipt or bill" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Photo or PDF").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await dialog.getByLabel("Paid to").fill(vendor);

  const receiptFiles = () =>
    sql(
      `select count(*) from storage.objects o join auth.users u on u.id::text = o.owner_id
       where o.bucket_id = 'receipts' and u.email = 'qa-staff@example.com';`,
    ).trim();
  const filesBefore = receiptFiles();

  // A figure that could be read two ways is refused, not guessed.
  await dialog.getByLabel("Total").fill("4.567");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter the total as an amount");
  expect(
    sql(`select count(*) from finance_receipt where vendor = '${vendor}';`).trim(),
    "a refused submission leaves no record",
  ).toBe("0");
  // ...and no file: the dialog removes the upload the server refused.
  await expect.poll(receiptFiles, { timeout: 30_000 }).toBe(filesBefore);

  await dialog.getByLabel("Total").fill("1 234,56 $");
  await dialog.getByLabel("GST").fill("53.69");
  await dialog.getByLabel("QST").fill("107.10");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await expect
    .poll(
      () =>
        sql(
          `select total_cents || '|' || gst_cents || '|' || qst_cents || '|' || scan_status || '|' ||
             (storage_path like organization_id || '/' || submitted_by || '/%')
           from finance_receipt where vendor = '${vendor}';`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe("123456|5369|10710|pending|true");

  // Only the one upload that was registered is in the bucket: the refused
  // attempt never uploaded, and nothing was orphaned.
  expect(
    sql(
      `select count(*) from storage.objects o join finance_receipt r on r.storage_path = o.name
       where o.bucket_id = 'receipts' and r.vendor = '${vendor}';`,
    ).trim(),
  ).toBe("1");

  const row = page.getByRole("row").filter({ hasText: vendor });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("$1,234.56");
  await expect(row).toContainText("Security check pending");
  await expect(row).toContainText("To review");
  // Staff do not review their own receipts.
  await expect(row.getByRole("button", { name: /Mark receipt/ })).toHaveCount(0);

  // Finance (an owner with MFA) sees it and marks it reviewed.
  await signOut(page);
  await signIn(page, "owner");
  await page.goto("/finance/receipts");
  const ownerRow = page.getByRole("row").filter({ hasText: vendor });
  await expect(ownerRow).toBeVisible({ timeout: 30_000 });
  await ownerRow.getByRole("button", { name: `Mark receipt from ${vendor} reviewed` }).click();
  await expect(ownerRow).toContainText("Reviewed", { timeout: 30_000 });
  expect(
    sql(
      `select r.status || '|' || (r.reviewed_by = u.id) from finance_receipt r, auth.users u
       where r.vendor = '${vendor}' and u.email = 'qa-owner@example.com';`,
    ).trim(),
  ).toBe("reviewed|true");

  // Once the scanner has passed the file, it opens.
  sql(`update finance_receipt set scan_status = 'clean' where vendor = '${vendor}';`);
  await page.reload();
  await expect(ownerRow.getByRole("button", { name: "Open receipt.png" })).toBeVisible({
    timeout: 30_000,
  });

  // The export carries the row with plain decimals for the spreadsheet.
  const response = await page.request.get("/api/finance/receipts/export?status=reviewed");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const csv = await response.text();
  expect(csv.charCodeAt(0), "starts with a byte-order mark for Excel").toBe(0xfeff);
  const line = csv.split("\r\n").find((l) => l.includes(vendor));
  expect(line).toContain(",1234.56,53.69,107.10,");
  expect(line).toContain("Reviewed");
});

test("a volunteer cannot reach receipts or their export", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "volunteer");
  await page.goto("/finance/receipts");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Receipts", exact: true })).toHaveCount(0);

  const response = await page.request.get("/api/finance/receipts/export", {
    maxRedirects: 0,
  });
  expect(response.status(), "the export redirects away rather than answering").toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
});
