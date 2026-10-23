import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Blocked uploads (REL-002), with quarantined rows seeded as the scan job
 * writes them: the uploader is told why in their language, and an
 * administrator releases a password-protected file with a reason and
 * deletes a file with a virus, each recorded in the audit log.
 */

const stamp = Date.now();
const staffId = () => sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);

function seed() {
  const staff = staffId();
  const org = sql(`select organization_id::text from organization_membership where user_id = '${staff}' limit 1`);
  const insert = (title: string, note: string) =>
    sql(`insert into document (organization_id, title, kind, storage_path, owner_id, created_by, scan_status, scan_note, quarantined_at)
         values ('${org}', '${title}', 'file', '${org}/${staff}/${crypto.randomUUID()}/f.pdf', '${staff}', '${staff}',
                 'quarantined', '${note}', now()) returning id::text`);
  return {
    locked: insert(`Locked PDF ${stamp}`, "Heuristics.Encrypted.PDF"),
    virus: insert(`Virus file ${stamp}`, "Eicar-Test-Signature"),
  };
}

const ids = seed();

test("the uploader sees why each file is blocked, in English and in French", async ({ page }) => {
  await signIn(page, "staff");
  await page.goto("/documents");
  await expect(page.getByText(`Locked PDF ${stamp}`)).toBeVisible();
  await expect(page.getByText("This file is password-protected, so it could not be checked for viruses. Remove the password and upload it again.").first()).toBeVisible();
  await expect(page.getByText("A virus was found in this file. It is blocked and cannot be opened.").first()).toBeVisible();

  sql(`update user_profile set locale = 'fr-CA' where id = '${staffId()}'`);
  try {
    await page.context().clearCookies({ name: "qbbe-locale" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
    await expect(page.getByText("Ce fichier est protégé par un mot de passe, alors il n’a pas pu être vérifié contre les virus. Retirez le mot de passe et téléversez-le de nouveau.").first()).toBeVisible();
    await expect(page.getByText("Un virus a été détecté dans ce fichier. Il est bloqué et ne peut pas être ouvert.").first()).toBeVisible();
  } finally {
    sql(`update user_profile set locale = null where id = '${staffId()}'`);
  }
  await signOut(page);
});

test("an administrator releases a password-protected file with a reason and deletes a file with a virus", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/jobs");
  const section = page.getByRole("region", { name: "Blocked files" });

  const locked = section.getByRole("listitem").filter({ hasText: `Locked PDF ${stamp}` });
  await expect(locked.getByText("Scanner result: Heuristics.Encrypted.PDF")).toBeVisible();
  await locked.getByLabel("Why it is safe to release").fill("The sender removed nothing; the treasurer checked it with them");
  await clickWhenInteractive(locked.getByRole("button", { name: "Release" }));
  await expect(locked.getByRole("status")).toHaveText("File released.");

  const virus = section.getByRole("listitem").filter({ hasText: `Virus file ${stamp}` });
  // A virus is never offered for release.
  await expect(virus.getByRole("button", { name: "Release" })).toHaveCount(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await clickWhenInteractive(virus.getByRole("button", { name: "Delete file" }));
  await expect(virus.getByRole("status")).toHaveText("File deleted.");

  expect(sql(`select scan_status from document where id = '${ids.locked}'`)).toBe("clean");
  expect(sql(`select scan_note like 'Deleted by an administrator%' from document where id = '${ids.virus}'`)).toBe("t");
  expect(sql(`select count(*) from audit_event where object_id in ('${ids.locked}', '${ids.virus}')
              and action in ('quarantine_released', 'quarantine_purged')`)).toBe("2");
});
