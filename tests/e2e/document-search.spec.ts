import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";
import { renderTextPdf } from "../../src/features/documents/templates/pdf";

/**
 * Browser evidence for search inside files and for templates (#147).
 *
 * The allow/deny rules are proved at the database in
 * `supabase/tests/document-search-templates.sql`. What is settled here is that
 * the pages drive them end to end: a word printed on a scanned receipt is read
 * on the device and finds the receipt; a PDF's text layer is read and finds
 * the document, with the match marked; a staff-only document never shows up in
 * a volunteer's search; and a template generates a PDF filed in the library.
 *
 * Every file is fabricated in the test (a canvas drawing, a PDF written by the
 * app's own writer): nothing real, and no binary in this public repository.
 */

const quote = (value: string) => value.replace(/'/g, "''");

/** Large black-on-white text on a canvas, returned as a PNG. */
async function scannedImage(page: Page, lines: string[]): Promise<Buffer> {
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

test("a word printed on a scanned receipt finds it, and only for people who may open it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const vendor = `Search QA ${Date.now()}`;

  await signIn(page, "staff");
  await page.goto("/finance/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Submit receipt" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit a receipt or bill" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  await dialog.getByLabel("Photo or PDF").setInputFiles({
    name: "scan.png",
    mimeType: "image/png",
    buffer: await scannedImage(page, ["PAPETERIE HIBISCUS", "CARTOUCHES TONER", "TOTAL 12,34"]),
  });
  await dialog.getByLabel("Paid to").fill(vendor);
  await expect(dialog.getByRole("status")).toContainText("Receipt read", { timeout: 120_000 });
  await dialog.getByLabel("Total").fill("12.34");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  // The words were stored beside the receipt, read by OCR.
  await expect
    .poll(
      () =>
        sql(
          `select t.source || '|' || (lower(t.content) like '%hibiscus%')
             from document_text t join finance_receipt r on r.id = t.receipt_id
            where r.vendor = '${quote(vendor)}';`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe("ocr|true");

  // Searching the library for the printed word finds the receipt. The vendor
  // name typed by hand does not contain it, so this is a match inside the file.
  await page.goto("/documents?q=hibiscus");
  const receipts = page.getByRole("region", { name: "Receipts" });
  await expect(receipts.getByRole("link", { name: new RegExp(vendor) })).toBeVisible({
    timeout: 30_000,
  });
  await expect(receipts.locator("mark").first()).toHaveText(/hibiscus/i);

  // A volunteer cannot open receipts, so search never shows them one.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto("/documents?q=hibiscus");
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("region", { name: "Receipts" })).toHaveCount(0);
  await expect(page.getByText(vendor)).toHaveCount(0);
});

test("a PDF's words find it, and a staff-only document never appears in a volunteer's search", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const word = `quartzite${stamp}`;
  const title = `Salary grid ${stamp}`;
  const pdf = Buffer.from(
    renderTextPdf({
      title: "Salary grid",
      text: `Confidential salary grid.\n\nThe ${word} adjustment applies from January.`,
    }),
  );

  await signIn(page, "staff");
  await page.goto("/documents");
  await page.getByRole("button", { name: "Add resource" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a resource" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("File", { exact: true }).setInputFiles({
    name: "salary-grid.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(dialog.getByRole("status")).toContainText("The words in this file were read", {
    timeout: 120_000,
  });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Folder", { exact: true }).selectOption({ label: "HR / Personnel (staff only)" });
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  await expect
    .poll(
      () =>
        sql(
          `select t.source from document_text t join document d on d.id = t.document_id
            where d.title = '${quote(title)}';`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe("pdf_text");

  // Found by a word that is only inside the file, with the match marked.
  await page.goto(`/documents?q=${word}`);
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.locator("mark")).toHaveText(word);

  // The same search as a volunteer returns nothing: not the title, not a snippet.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(`/documents?q=${word}`);
  await expect(page.getByText("No documents match")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(title)).toHaveCount(0);
  await page.goto(`/documents?q=${encodeURIComponent(title)}`);
  await expect(page.getByText("No documents match")).toBeVisible({ timeout: 30_000 });
});

test("an owner writes a French template; staff generate a PDF from it into the library", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const name = `Lettre de bienvenue ${stamp}`;

  await signIn(page, "owner");
  await page.goto("/documents/templates");
  await expect(page.getByRole("heading", { name: "Document templates" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "New template" }).click();
  const editor = page.getByRole("dialog", { name: "New template" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.getByLabel("Name", { exact: true }).fill(name);
  await editor.getByLabel("Type", { exact: true }).selectOption({ label: "Acknowledgement" });
  await editor.getByLabel("Language", { exact: true }).selectOption({ label: "Français" });
  await editor.getByLabel("Merges", { exact: true }).selectOption({ label: "A member of the organization" });

  // A field the record cannot fill is refused, not left in the letter.
  await editor.getByLabel("Text", { exact: true }).fill("Bonjour {{gift.amount}}");
  await editor.getByRole("button", { name: "Save template" }).click();
  await expect(editor.getByRole("alert")).toContainText("{{gift.amount}}");

  await editor
    .getByLabel("Text", { exact: true })
    .fill(`Bonjour {{person.name}},\n\nBienvenue depuis le {{person.joined_on}}. Référence ${stamp}.`);
  await editor.getByLabel("File generated documents in", { exact: true }).selectOption({
    label: "HR / Personnel (staff only)",
  });
  await editor.getByRole("button", { name: "Save template" }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });

  // Staff generate from it, but cannot write or change templates.
  await signOut(page);
  await signIn(page, "staff");
  await page.goto("/documents/templates");
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "New template" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Edit ${name}` })).toHaveCount(0);

  await clickWhenInteractive(page.getByRole("button", { name: `Generate from ${name}` }));
  const generate = page.getByRole("dialog", { name: `Generate: ${name}` });
  await expect(generate).toBeVisible({ timeout: 30_000 });
  await generate.getByLabel("A member of the organization").selectOption({ index: 1 });
  await generate.getByRole("button", { name: "Generate document" }).click();
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: new RegExp(`^${name} – `) })).toBeVisible({
    timeout: 30_000,
  });

  const saved = sql(
    `select d.mime_type || '|' || f.name || '|' || t.source || '|' ||
            (t.content like 'Bonjour %Bienvenue depuis le % 20__.%Référence ${stamp}.%')
       from document d
       join document_template tp on tp.id = d.template_id
       join document_folder f on f.id = d.folder_id
       join document_text t on t.document_id = d.id
      where tp.name = '${quote(name)}';`,
  ).trim();
  expect(saved, "saved as a PDF in the template's folder, with its words stored for search").toBe(
    "application/pdf|Personnel|generated|true",
  );
});
