import { createHash } from "node:crypto";
import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { CONSENT_STATEMENT } from "../../src/features/forms/fields";

/**
 * Digital forms (#145 v1) and e-signatures (#144 v1). Who may do what is
 * proved at the database in `supabase/tests/forms-esign.sql`; this settles
 * what only a browser can: an admin builds and publishes a form, a volunteer
 * fills it in with a money amount and a photo and signs it, the record shows
 * its signature and verifies, and the admin exports it. Then a PDF is sent
 * for signature, signed, and verified against its bytes.
 */

// A 1x1 PNG: enough for Storage to accept the upload as an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

test("an admin publishes a form; a volunteer fills and signs it; the admin exports it", async ({ page }) => {
  test.setTimeout(300_000);
  const title = `Program registration QA ${Date.now()}`;

  await signIn(page, "owner");
  await page.goto("/forms/new");
  await expect(page.getByRole("heading", { name: "New form" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Must be signed").check();

  const q = (n: number) => page.getByRole("group", { name: `Question ${n}`, exact: true });
  await page.getByRole("textbox", { name: "Question 1", exact: true }).fill("Participant name");
  await q(1).getByLabel("Required").check();

  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("textbox", { name: "Question 2", exact: true }).fill("Fee paid");
  await q(2).getByLabel("Answer type").selectOption("money");

  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("textbox", { name: "Question 3", exact: true }).fill("T-shirt");
  await q(3).getByLabel("Answer type").selectOption("choice");
  await q(3).getByLabel("Options").fill("S\nM\nL");

  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("textbox", { name: "Question 4", exact: true }).fill("Photo");
  await q(4).getByLabel("Answer type").selectOption("file");

  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const formId = page.url().split("/").pop()!;
  await expect(page.getByText("Draft: not visible to members yet")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("link", { name: "View submissions" })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select status || '|' || (published_at is not null) from form_definition where id = '${formId}';`))
    .toBe("published|true");

  // A volunteer finds it and fills it in.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto("/forms");
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Participant name").fill("Ana Tremblay");
  await page.getByLabel("T-shirt").selectOption("M");
  await page.getByLabel("Photo").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });

  // A figure that could be read two ways is refused, not guessed.
  await page.getByLabel("Fee paid").fill("4.567");
  await page.getByLabel("Type your full name to sign").fill("Ana Tremblay");
  await page.getByLabel(CONSENT_STATEMENT).check();
  await page.getByRole("button", { name: "Sign and submit" }).click();
  await expect(page.getByRole("form", { name: "Fill in the form" }).getByRole("alert")).toContainText(
    "Enter “Fee paid” as an amount",
  );
  expect(sql(`select count(*) from form_submission where form_id = '${formId}';`)).toBe("0");
  const orphans = () =>
    sql(`select count(*) from storage.objects o where o.bucket_id = 'form-files'
         and not exists (select 1 from form_file f where f.storage_path = o.name)
         and o.owner_id = (select id::text from auth.users where email = 'qa-volunteer@example.com');`);
  const orphansBefore = orphans();

  // Refused by the server after the photo was uploaded (the form closed in
  // the meantime): the upload is removed again, not left behind.
  await page.getByLabel("Fee paid").fill("1 234,56 $");
  sql(`update form_definition set status = 'closed' where id = '${formId}';`);
  await page.getByRole("button", { name: "Sign and submit" }).click();
  await expect(page.getByRole("form", { name: "Fill in the form" }).getByRole("alert")).toContainText(
    "This form is not open for submissions.",
    { timeout: 30_000 },
  );
  expect(orphans(), "a refused submission leaves no orphaned upload").toBe(orphansBefore);
  sql(`update form_definition set status = 'published' where id = '${formId}';`);

  await page.getByRole("button", { name: "Sign and submit" }).click();
  await page.waitForURL(/\/forms\/submissions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const submissionId = page.url().split("/").pop()!;

  await expect(page.getByText("$1,234.56")).toBeVisible();
  await expect(page.getByText("Security check pending")).toBeVisible();
  const signature = page.getByTestId("signature");
  await expect(signature).toContainText("Signed by Ana Tremblay");
  await expect(signature).toContainText("Content unchanged since signing");
  await expect(signature).toContainText(CONSENT_STATEMENT);

  // What the database recorded, by itself.
  expect(
    sql(`select (s.answers->>'field_2') || '|' || (s.answers->>'field_3') || '|' ||
           (g.signer_id = s.submitted_by) || '|' || (g.content_sha256 = s.content_sha256) || '|' ||
           (g.consent_statement = app.signature_consent_statement())
         from form_submission s join signature g on g.form_submission_id = s.id
         where s.id = '${submissionId}';`),
  ).toBe("123456|M|true|true|true");
  expect(sql(`select app.signature_consent_statement();`), "the app shows the words the database stores")
    .toBe(CONSENT_STATEMENT);
  expect(
    sql(`select count(*) from audit_event where object_id = '${submissionId}' and action in ('form_submitted', 'signed');`),
  ).toBe("2");

  // The admin sees it, opens the scanned file, and exports the CSV.
  sql(`update form_file set scan_status = 'clean' where submission_id = '${submissionId}';`);
  await signOut(page);
  await signIn(page, "owner");
  await page.goto(`/forms/${formId}/submissions`);
  const row = page.getByRole("row").filter({ hasText: "Ana Tremblay" });
  await expect(row).toContainText("$1,234.56", { timeout: 30_000 });
  await expect(row).toContainText("Signed");
  await page.goto(`/forms/submissions/${submissionId}`);
  await expect(page.getByRole("button", { name: "Open photo.png" })).toBeVisible({ timeout: 30_000 });

  const response = await page.request.get(`/api/forms/${formId}/export`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const csv = await response.text();
  expect(csv.charCodeAt(0), "starts with a byte-order mark for Excel").toBe(0xfeff);
  expect(csv).toContain("Participant name,Fee paid,T-shirt,Photo,Signed by,Signed at,Content SHA-256");
  const line = csv.split("\r\n").find((l) => l.includes(submissionId));
  expect(line).toContain(",Ana Tremblay,1234.56,M,photo.png,Ana Tremblay,");

  // Published questions are frozen: no edit link, and the edit route sends you back.
  await page.goto(`/forms/${formId}/edit`);
  await page.waitForURL(new RegExp(`/forms/${formId}$`), { timeout: 30_000 });
});

test("a PDF is sent for signature, signed, and verified against its bytes", async ({ page }) => {
  test.setTimeout(240_000);
  const title = `Volunteer agreement QA ${Date.now()}`;
  const volunteerName = sql(
    `select p.full_name from user_profile p join auth.users u on u.id = p.id where u.email = 'qa-volunteer@example.com';`,
  );

  await signIn(page, "owner");
  await page.goto("/signatures");
  await page.getByRole("button", { name: "Send a PDF for signature" }).click();
  const dialog = page.getByRole("dialog", { name: "Send a PDF for signature" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("PDF", { exact: true }).setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: PDF });
  await dialog.getByLabel(volunteerName, { exact: true }).check();
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForURL(/\/signatures\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const documentId = page.url().split("/").pop()!;
  await expect(page.getByText("Security check pending")).toBeVisible();

  // The scanner's job, done here: a clean verdict and the hash of the bytes.
  const hash = createHash("sha256").update(PDF).digest("hex");
  sql(`update signing_document set scan_status = 'clean', content_sha256 = '${hash}' where id = '${documentId}';`);

  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto("/signatures");
  await page.getByRole("link", { name: title }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Open agreement.pdf" })).toBeVisible();
  await page.getByLabel("Type your full name to sign").fill(volunteerName);
  await page.getByLabel(CONSENT_STATEMENT).check();
  await page.getByRole("button", { name: "Sign", exact: true }).click();

  const signature = page.getByTestId("signature");
  await expect(signature).toContainText(`Signed by ${volunteerName}`, { timeout: 30_000 });
  await expect(signature).toContainText("Content unchanged since signing");
  await expect(signature).toContainText(hash);
  await expect(page.getByLabel("Type your full name to sign")).toHaveCount(0);
  expect(
    sql(`select (g.content_sha256 = '${hash}') || '|' || (u.email = 'qa-volunteer@example.com')
         from signature g join auth.users u on u.id = g.signer_id where g.signing_document_id = '${documentId}';`),
  ).toBe("true|true");
  expect(
    sql(`select count(*) from audit_event where object_id = '${documentId}' and action = 'signed';`),
  ).toBe("1");
});

test("a volunteer cannot build forms, send documents or export submissions", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "volunteer");
  await page.goto("/forms/new");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  await page.goto("/signatures");
  await expect(page.getByRole("heading", { name: "Signatures" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send a PDF for signature" })).toHaveCount(0);
  const response = await page.request.get(`/api/forms/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/export`, {
    maxRedirects: 0,
  });
  expect(response.status(), "the export redirects away rather than answering").toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
});
