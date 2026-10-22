import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Upload, scan, download, with a real ClamAV. Staff upload a clean file and
 * the EICAR test file (a harmless string every scanner reports as a virus)
 * through the library; the scan job runs as the scheduler would call it; the
 * clean one downloads and the other stays quarantined, refused to everyone.
 *
 * Needs a clamd the app reaches (CLAMAV_HOST on the server) and the job
 * secret; CI's browser job starts one and sets QA_CLAMAV=1. Without a scanner
 * a file stays "Security check pending" by design, so the test is skipped
 * rather than failed.
 */

const JOB_SECRET = process.env.CRON_JOB_SECRET ?? "";
// Assembled so this file itself is not the EICAR string.
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");

async function upload(page: Page, title: string, name: string, body: string) {
  await page.goto("/documents");
  await page.getByRole("button", { name: "Add resource" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a resource" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("File", { exact: true }).setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(body) });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

test("an uploaded file is scanned: the clean one downloads, the infected one stays quarantined", async ({ page }) => {
  test.skip(process.env.QA_CLAMAV !== "1", "needs a ClamAV scanner and the job secret (QA_CLAMAV=1)");
  test.setTimeout(300_000);
  const stamp = Date.now();
  const clean = `Scan clean ${stamp}`;
  const infected = `Scan infected ${stamp}`;

  await signIn(page, "staff");
  await upload(page, clean, "minutes.txt", `Board minutes ${stamp}\n`);
  await upload(page, infected, "eicar.txt", EICAR);
  const status = (title: string) => sql(`select scan_status from document where title = '${title}'`);
  expect(status(clean)).toBe("pending");
  expect(status(infected)).toBe("pending");

  // Nothing opens before the scan.
  const row = (title: string) => page.getByRole("row").filter({ hasText: title });
  await page.goto("/documents");
  await expect(row(clean)).toContainText("Security check pending", { timeout: 30_000 });

  // The scheduler's call. One run may not reach both; run until neither is pending.
  await expect
    .poll(
      async () => {
        const run = await page.request.post("/api/jobs/scan-documents", { headers: { "x-job-secret": JOB_SECRET } });
        expect(run.status()).toBe(200);
        return `${status(clean)}|${status(infected)}`;
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe("clean|quarantined");
  expect(sql(`select (quarantined_at is not null)::text from document where title = '${infected}'`)).toBe("true");

  await page.reload();
  await expect(row(infected)).toContainText("Quarantined", { timeout: 30_000 });
  await expect(row(clean)).not.toContainText("Security check pending");

  // The clean file downloads, with its own bytes.
  await row(clean).getByRole("button", { name: `Actions for ${clean}` }).click();
  const popup = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Download" }).click();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(await opened.content()).toContain(`Board minutes ${stamp}`);
  await opened.close();

  // The infected one offers no way to open it.
  await expect(row(infected).getByRole("button", { name: new RegExp(`^${infected}`) })).toBeDisabled();
  await row(infected).getByRole("button", { name: `Actions for ${infected}` }).click();
  await expect(page.getByRole("menuitem", { name: "Details and versions" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Download", disabled: false })).toHaveCount(0);
});
