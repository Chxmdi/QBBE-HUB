import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Acceptance evidence for #35 (P0-FIL-01, external document links).
 *
 * The row asks that people can attach "approved links to Google Drive or
 * another QBBE-controlled source". Until this work the only thing expressing
 * "approved" was a placeholder in the dialog; `linkSchema` took any URL that
 * `new URL()` would parse, which includes `javascript:` and any third-party
 * host. A link document's stored URL is handed to `window.open` when somebody
 * opens it, so the library was sending colleagues wherever the row said.
 *
 * The refusals are proved at the database in `supabase/tests/document-links.sql`,
 * because that is where the guarantee lives and the form is not a control.
 * What is settled here is the half only a browser can settle: that an approved
 * link goes in and comes back, that the form says what it will accept before
 * the person types, and that a refusal explains itself instead of failing
 * silently.
 *
 * P1-FIL-02 uploads are deliberately not claimed here. Its definition of done
 * needs live QBBE-hosted ClamAV acceptance, which does not exist yet; the
 * pending-state check in `hello-hub.spec.ts` remains the only browser evidence
 * that is honest to record for it.
 */

test("an approved resource link is saved, and the form says what it will accept", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  await page.goto("/documents");

  const title = `Approved link ${Date.now()}`;
  await page.getByRole("button", { name: "Add resource" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a resource" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  await dialog.getByRole("tab", { name: "External link" }).click();

  // The form states the policy up front. A person should not have to discover
  // the allowlist by tripping over it.
  await expect(dialog.getByText(/Links must be https and point at .*Google Drive/)).toBeVisible({
    timeout: 30_000,
  });

  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("URL", { exact: true }).fill("https://drive.google.com/file/d/qa/view");
  await dialog.getByRole("button", { name: "Add resource", exact: true }).click();

  // Read the stored row rather than the list that has just redrawn itself.
  await expect
    .poll(
      () =>
        sql(
          `select url from document where title = '${title.replace(/'/g, "''")}' limit 1;`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe("https://drive.google.com/file/d/qa/view");

  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("a link to an unapproved source is refused, and the refusal names the sources that work", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  await page.goto("/documents");

  const title = `Unapproved link ${Date.now()}`;
  await page.getByRole("button", { name: "Add resource" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a resource" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("tab", { name: "External link" }).click();

  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("URL", { exact: true }).fill("https://example.com/not-ours.pdf");
  await dialog.getByRole("button", { name: "Add resource", exact: true }).click();

  // A refusal that names the host and the alternatives, rather than a generic
  // failure the person has to guess at.
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("example.com", { timeout: 30_000 });
  await expect(alert).toContainText("Google Drive");

  // And nothing was stored. A form that reports an error while writing the row
  // anyway would be the worse failure.
  expect(
    sql(
      `select count(*)::text from document where title = '${title.replace(/'/g, "''")}';`,
    ).trim(),
  ).toBe("0");
});
