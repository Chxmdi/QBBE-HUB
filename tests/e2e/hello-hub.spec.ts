import { expect, test } from "./fixtures";
import { signIn } from "./auth";

/**
 * Authenticated smoke: owner creates a project + milestone (Unit 2).
 * CI runs against its migrated, synthetic local Supabase database.
 */
test.use({
  video: { mode: "on", size: { width: 1280, height: 720 } },
});

test("owner edits, archives and restores a program", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  await page.goto("/programs?create=1");
  const name = `Program lifecycle ${Date.now()}`;
  // Scoped to the dialog: /programs also carries the "Save template" form for
  // administrators, so a page-wide "Name" matches two fields.
  const createProgram = page.getByRole("dialog", { name: "Create program" });
  await createProgram.getByLabel("Name", { exact: true }).fill(name);
  await createProgram.getByRole("button", { name: "Create program", exact: true }).click();
  await page.getByRole("link").filter({ has: page.getByRole("heading", { name, exact: true }) }).click();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Edit program" }).click();
  let programDialog = page.getByRole("dialog", { name: "Edit program" });
  await programDialog.getByLabel("Description", { exact: true }).fill("Revised program purpose");
  await programDialog.getByLabel("Status", { exact: true }).selectOption("archived");
  await programDialog.getByRole("button", { name: "Save program" }).click();
  await expect(programDialog).not.toBeVisible({ timeout: 30_000 });
  await page.goto("/programs");
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Archived programs", exact: true }).click();
  await page.getByRole("link").filter({ has: page.getByRole("heading", { name, exact: true }) }).click();
  await expect(page.getByText("Revised program purpose", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit program" }).click();
  programDialog = page.getByRole("dialog", { name: "Edit program" });
  await programDialog.getByLabel("Status", { exact: true }).selectOption("active");
  await programDialog.getByRole("button", { name: "Save program" }).click();
  await expect(programDialog).not.toBeVisible({ timeout: 30_000 });
  await page.goto("/programs");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

test("owner creates a project and a milestone", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const onboarding = page.getByRole("heading", { name: "Your profile" });
  const workspace = page.getByRole("link", { name: "Projects" });
  await expect(onboarding.or(workspace).first()).toBeVisible({ timeout: 20_000 });

  if (await onboarding.isVisible()) {
    await page.getByLabel("Full name").fill("QA Owner");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { name: "Get oriented" })).toBeVisible();
    await page.getByRole("button", { name: "Enter the workspace" }).click();
    await expect(workspace).toBeVisible({ timeout: 20_000 });
  }

  await page.goto("/projects?create=1");
  await expect(page.getByRole("heading", { name: "Create project" })).toBeVisible();
  const name = `Hello Hub ${Date.now()}`;
  await page.locator("#project-name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });
  const detailHeading = page.getByRole("heading", { name });
  await expect(detailHeading).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Add milestone" }).click();
  const milestoneDialog = page.getByRole("dialog", { name: "Add milestone" });
  await expect(milestoneDialog).toBeVisible();
  await milestoneDialog.getByLabel("Name", { exact: true }).fill("Pilot kickoff");
  await milestoneDialog.getByRole("button", { name: "Create", exact: true }).click();
  // Scoped to the section that owns milestones: the name is also an option in
  // the task dialog's milestone picker, so an unscoped match is ambiguous.
  const milestones = page.getByRole("region", { name: "Milestones", exact: true });
  await expect(milestones.getByText("Pilot kickoff", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(milestones.getByRole("button", { name: "Complete" })).toBeVisible();
});

test("a new upload stays visibly unavailable until its security check passes", async ({ page }) => {
  await signIn(page, "volunteer");
  await page.goto("/documents");

  const title = `Pending upload ${Date.now()}`;
  await page.getByRole("button", { name: "Add resource" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a resource" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "security-check.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("harmless browser fixture"),
  });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Document uploaded. Downloads become available after the security check."))
    .toBeVisible();

  // Verify the persisted server-rendered state, including the RLS-protected
  // pending record, rather than racing the client refresh after the action.
  await page.reload();

  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row.getByText("Security check pending", { exact: true })).toBeVisible();
  await expect(row.getByTitle("Security check pending")).toBeDisabled();
});
