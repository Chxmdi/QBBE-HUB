import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { clickWhenInteractive } from "./interactive";

/**
 * Reporting journey (#112, QA-FINAL "CRM/reporting"): a project report is
 * generated from real records, opened, and exported as CSV and PDF; the
 * export URLs refuse a volunteer rather than trusting that the link is
 * hidden from them.
 */

const PROJECT = "Fall Community Workshop Series";

test("a project report is generated, opened and exported, and its exports refuse a volunteer", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "owner");
  await page.goto("/reports");

  await clickWhenInteractive(page.getByRole("button", { name: "Generate report" }));
  const dialog = page.getByRole("dialog", { name: "Generate report" });
  await dialog.getByLabel("Type").selectOption("project");
  await dialog.getByLabel("Project (for project report)").selectOption({ label: PROJECT });
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  await dialog.getByLabel("Period start").fill(start.toISOString().slice(0, 10));
  await dialog.getByLabel("Period end").fill(end.toISOString().slice(0, 10));
  await dialog.getByRole("button", { name: "Generate" }).click();
  await expect(dialog).toBeHidden();

  // The newest report on the list is the one just generated.
  await page.goto("/reports");
  await page.getByRole("link", { name: new RegExp(PROJECT) }).first().click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  const reportUrl = new URL(page.url());
  await expect(page.locator("h1").first()).toContainText(PROJECT);
  await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();

  const csv = await page.request.get(`${reportUrl.pathname}/csv`);
  expect(csv.status(), "CSV export").toBe(200);
  expect(csv.headers()["content-type"]).toMatch(/text\/csv/);
  expect(await csv.text()).toContain(PROJECT);

  const pdf = await page.request.get(`${reportUrl.pathname}/pdf`);
  expect(pdf.status(), "PDF export").toBe(200);
  expect(pdf.headers()["content-type"]).toMatch(/application\/pdf/);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await signOut(page);
  await signIn(page, "volunteer");
  for (const format of ["csv", "pdf"]) {
    const refused = await page.request.get(`${reportUrl.pathname}/${format}`, { maxRedirects: 0 });
    expect(refused.status(), `a volunteer's ${format} export is refused`).not.toBe(200);
    expect(await refused.text(), `no report content in the refused ${format}`).not.toContain(PROJECT);
  }
  await page.goto(reportUrl.pathname);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Milestones" })).toHaveCount(0);
});
