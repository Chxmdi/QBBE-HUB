import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Browser evidence for the document library (#147): filing and searching,
 * versions, required reading and per-folder visibility.
 *
 * The allow/deny rules themselves are proved at the database in
 * `supabase/tests/document-library.sql`. What is settled here is that the
 * pages drive them: a person can file, find, replace and confirm a document,
 * and a volunteer is not shown what a staff-only folder holds.
 *
 * External links are used rather than uploads so every step can complete:
 * an uploaded file stays unopenable until the ClamAV scan passes, and there
 * is no scanner in the local stack.
 */

const quote = (value: string) => value.replace(/'/g, "''");

test("a document is filed, found by tag and title, replaced by a new version and confirmed as read", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const title = `Code of conduct ${stamp}`;
  const tag = `conduct${stamp}`;

  await signIn(page, "owner");
  await page.goto("/documents");

  // File it: Governance / Policies, with a tag.
  await page.getByRole("button", { name: "Add resource" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a resource" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("tab", { name: "External link" }).click();
  const linkPanel = dialog.getByRole("tabpanel");
  await linkPanel.getByLabel("Title", { exact: true }).fill(title);
  await linkPanel.getByLabel("URL", { exact: true }).fill("https://drive.google.com/file/d/coc-v1/view");
  await linkPanel.getByLabel("Folder", { exact: true }).selectOption({ label: "Governance / Policies" });
  await linkPanel.getByLabel(/^Tags/).fill(`${tag}, Policy`);
  await linkPanel.getByRole("button", { name: "Add resource", exact: true }).click();

  await expect
    .poll(
      () =>
        sql(
          `select f.name || '|' || array_to_string(d.tags, ',') from document d
             join document_folder f on f.id = d.folder_id
            where d.title = '${quote(title)}' limit 1;`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe(`Policies|${tag},policy`);

  // Found by tag, by title words, and not by words it does not contain.
  await page.goto(`/documents?tag=${tag}`);
  await expect(page.getByRole("button", { name: new RegExp(`^${title}`) })).toBeVisible({ timeout: 30_000 });

  await page.goto("/documents");
  await page.locator("#library-q").fill(`conduct ${stamp}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=conduct/);
  await expect(page.getByRole("button", { name: new RegExp(`^${title}`) })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/documents?q=no-such-words-${stamp}`);
  await expect(page.getByText("No documents match")).toBeVisible({ timeout: 30_000 });

  // A new version: the old one is kept and marked, the new one is current.
  const firstId = sql(`select id from document where title = '${quote(title)}' limit 1;`).trim();
  await page.goto(`/documents/${firstId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Upload new version" }).click();
  const versionDialog = page.getByRole("dialog", { name: "Upload a new version" });
  await versionDialog.getByRole("tab", { name: "External link" }).click();
  await versionDialog.getByLabel("URL", { exact: true }).fill("https://drive.google.com/file/d/coc-v2/view");
  await versionDialog.getByRole("button", { name: "Save version" }).click();

  const history = page.getByRole("list", { name: "Version history" });
  await expect(history.getByRole("listitem")).toHaveCount(2, { timeout: 30_000 });
  await expect(history.getByRole("listitem").first()).toContainText("Version 2");
  await expect(history.getByRole("listitem").first()).toContainText("Current version");
  await expect(history.getByRole("listitem").nth(1)).toContainText("Earlier version");
  await expect(page.getByRole("button", { name: "Open version 1" })).toBeEnabled();

  // The library lists the document once, at its current version.
  await page.goto(`/documents?tag=${tag}`);
  await expect(page.getByRole("button", { name: new RegExp(`^${title}`) })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText("Version 2", { exact: false })).toBeVisible();

  // Required reading: mark it, confirm it, and see who has and hasn't.
  const currentId = sql(
    `select id from document where title = '${quote(title)}' and superseded_at is null;`,
  ).trim();
  await page.goto(`/documents/${currentId}`);
  await page.getByLabel(/Required reading/).check();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("button", { name: "I have read this" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "I have read this" }).click();
  await expect(page.getByText(/You confirmed you read version 2/)).toBeVisible({ timeout: 30_000 });

  const report = page.getByRole("table", { name: "Who has read this" });
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.getByRole("row", { name: /Not yet/ }).first()).toBeVisible();
  await expect(page.getByText(/1 of \d+ have confirmed/)).toBeVisible();

  expect(
    sql(
      `select count(*) from audit_event
        where action in ('document_version_added', 'document_acknowledged', 'document_required_reading_set')
          and object_id = '${currentId}';`,
    ).trim(),
  ).toBe("3");
});

test("a volunteer is not shown a document filed in a staff-only folder", async ({ page }) => {
  test.setTimeout(180_000);
  const title = `Salary grid ${Date.now()}`;
  const id = sql(
    `insert into document (organization_id, title, kind, url, folder_id, owner_id, created_by)
     select m.organization_id, '${quote(title)}', 'link', 'https://drive.google.com/file/d/hr/view',
            f.id, m.user_id, m.user_id
       from organization_membership m
       join document_folder f on f.organization_id = m.organization_id
                             and f.category = 'hr' and f.name = 'Personnel'
      where m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
     returning id;`,
  ).trim();

  await signIn(page, "volunteer");
  await page.goto(`/documents?q=${encodeURIComponent(title)}`);
  await expect(page.getByText("No documents match")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#library-folder option", { hasText: "Personnel" })).toHaveCount(0);

  await page.goto(`/documents/${id}`);
  await expect(page.getByRole("heading", { name: /Not found/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(title)).toHaveCount(0);
});
