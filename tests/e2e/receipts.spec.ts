import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
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
  // Submitting waits for the photo's words to be read, for library search
  // (#147); on a slow runner the reader may still be loading at this point.
  await expect(dialog).toBeHidden({ timeout: 120_000 });

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

/**
 * A fabricated receipt, drawn on a canvas in the browser and handed back as a
 * PNG: nothing real, and no binary committed to this public repository. Large,
 * plain black-on-white text, so the OCR engine reads it reliably.
 */
async function receiptImage(page: Page, lines: string[]): Promise<Buffer> {
  const dataUrl = await page.evaluate((text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 120 + text.length * 72;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = "bold 44px sans-serif";
    text.forEach((line, i) => ctx.fillText(line, 60, 100 + i * 72));
    return canvas.toDataURL("image/png");
  }, lines);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Serious or critical WCAG 2.2 AA violations inside the dialog. */
async function axeProblems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

/**
 * Receipt reading (#142 v2). The photo is read in the browser; what it finds
 * goes only into empty fields, marked as a suggestion, stays editable, and is
 * never submitted for the person.
 *
 * What this asserts and why it is stable: the image is clean synthetic text,
 * and every expected figure appears on it exactly once beside its keyword, so
 * the test needs the engine to read digits and those keywords, which it does
 * consistently on text like this. The vendor is typed by hand before reading
 * finishes, so no assertion depends on how the engine spells a name, and that
 * doubles as the check that a field the person filled is never overwritten.
 * The finer extraction rules (subtotal versus total, tips, rates, dates) are
 * covered on plain text in src/features/finance/tests/receipt-extract.test.ts.
 */
test("a receipt photo is read on the device and suggests the empty fields", async ({ page }) => {
  test.setTimeout(240_000);
  const vendor = `OCR QA ${Date.now()}`;
  // A date a few days back, so it is never after "today" wherever this runs.
  const receiptDate = new Date(Date.now() - 3 * 86_400_000).toLocaleDateString("en-CA");

  await signIn(page, "staff");
  await page.goto("/finance/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible({ timeout: 30_000 });

  // The OCR engine is not part of the page until a photo is chosen.
  const ocrRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/ocr/")) ocrRequests.push(r.url());
  });

  await page.getByRole("button", { name: "Submit receipt" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit a receipt or bill" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  expect(ocrRequests, "nothing of the OCR engine loads before a photo is chosen").toEqual([]);

  const image = await receiptImage(page, [
    "CAFE IMAGINAIRE",
    receiptDate,
    "Sous-total 40,00",
    "TPS 5% 2,00",
    "TVQ 9,975% 3,99",
    "TOTAL 45,99",
  ]);
  await dialog.getByLabel("Photo or PDF").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: image,
  });

  // Reading is under way, with a way out, and typing still works meanwhile.
  await expect(dialog.getByRole("button", { name: "Skip reading" })).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("You can keep typing");
  await dialog.getByLabel("Paid to").fill(vendor);

  await expect(dialog.getByRole("status")).toContainText("Receipt read. Suggested", {
    timeout: 120_000,
  });
  await expect(dialog.getByRole("button", { name: "Skip reading" })).toHaveCount(0);
  // Engine, core and language data all came from this app's own origin.
  expect(ocrRequests.length).toBeGreaterThan(0);
  for (const url of ocrRequests) expect(new URL(url).origin).toBe(new URL(page.url()).origin);

  await expect(dialog.getByLabel("Date on the receipt")).toHaveValue(receiptDate);
  await expect(dialog.getByLabel("Total")).toHaveValue("45.99");
  await expect(dialog.getByLabel("GST")).toHaveValue("2.00");
  await expect(dialog.getByLabel("QST")).toHaveValue("3.99");
  // The name typed by hand was not replaced.
  await expect(dialog.getByLabel("Paid to")).toHaveValue(vendor);
  await expect(dialog.getByLabel("Paid to")).not.toHaveAccessibleDescription(/Suggested/);
  // Each suggestion is marked, visibly and for screen readers.
  await expect(dialog.getByText("Suggested — check before submitting")).toHaveCount(4);
  await expect(dialog.getByLabel("Total")).toHaveAccessibleDescription(
    "Suggested — check before submitting",
  );
  // 2.00 and 3.99 are 5 % and 9.975 % of 40.00: no warning.
  await expect(dialog.getByText("Check the taxes")).toHaveCount(0);
  expect(await axeProblems(page)).toEqual([]);

  // Suggestions stay editable; an edited one is no longer marked.
  await dialog.getByLabel("GST").fill("5.00");
  await expect(dialog.getByLabel("GST")).toHaveValue("5.00");
  await expect(dialog.getByText("Suggested — check before submitting")).toHaveCount(3);
  await expect(dialog.getByText("Check the taxes")).toBeVisible();
  await dialog.getByLabel("GST").fill("2.00");
  await expect(dialog.getByText("Check the taxes")).toHaveCount(0);

  // Nothing was submitted on the person's behalf.
  expect(sql(`select count(*) from finance_receipt where vendor = '${vendor}';`).trim()).toBe("0");

  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        sql(
          `select document_date || '|' || total_cents || '|' || gst_cents || '|' || qst_cents
           from finance_receipt where vendor = '${vendor}';`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe(`${receiptDate}|4599|200|399`);
});

test("reading can be skipped, and a PDF is not read for figures, without blocking a manual submission", async ({ page }) => {
  test.setTimeout(180_000);
  const vendor = `OCR skip QA ${Date.now()}`;

  await signIn(page, "staff");
  await page.goto("/finance/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Submit receipt" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit a receipt or bill" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // A PDF: nothing is read for figures. Its words are read for library
  // search only (#147), in their own status line; this one is not a real PDF,
  // so that reading fails quietly and fills nothing in.
  await dialog.getByLabel("Photo or PDF").setInputFiles({
    name: "bill.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(dialog.getByRole("status").nth(1)).toContainText(/could not be read|No words could be read/, {
    timeout: 60_000,
  });
  await expect(dialog.getByRole("button", { name: "Skip reading" })).toHaveCount(0);
  await expect(dialog.getByRole("status").first()).toBeEmpty();
  await expect(dialog.getByText("Suggested — check before submitting")).toHaveCount(0);

  // A photo, skipped from the keyboard straight away.
  const image = await receiptImage(page, ["CAFE IMAGINAIRE", "TOTAL 12,34"]);
  await dialog.getByLabel("Photo or PDF").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: image,
  });
  const skip = dialog.getByRole("button", { name: "Skip reading" });
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Automatic reading skipped. Type the figures in.");
  await expect(skip).toHaveCount(0);
  await expect(dialog.getByLabel("Total")).toHaveValue("");
  await expect(dialog.getByText("Suggested — check before submitting")).toHaveCount(0);

  // The stopped reading never fills anything in later.
  await page.waitForTimeout(3_000);
  await expect(dialog.getByLabel("Total")).toHaveValue("");

  await dialog.getByLabel("Paid to").fill(vendor);
  await dialog.getByLabel("Total").fill("12.34");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect
    .poll(() => sql(`select total_cents from finance_receipt where vendor = '${vendor}';`).trim(), {
      timeout: 30_000,
    })
    .toBe("1234");
});
