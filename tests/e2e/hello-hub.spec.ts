import { expect, test } from "@playwright/test";

/**
 * Opt-in smoke: staff creates a project + milestone (Unit 2).
 * Not part of default CI (`npx playwright test public-routes` only).
 */
test.use({
  video: { mode: "on", size: { width: 1280, height: 720 } },
});

test("owner creates a project and a milestone", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("qa-owner@example.com");
  await page.getByLabel("Password").fill("QaTest!2026");
  await page.getByRole("button", { name: "Sign in" }).click();

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
  const detailHeading = page.getByRole("heading", { name });
  const listLink = page.getByRole("link", { name, exact: true });
  await expect(detailHeading.or(listLink).first()).toBeVisible({ timeout: 20_000 });
  if (!(await detailHeading.isVisible())) {
    await listLink.click();
  }
  await expect(detailHeading).toBeVisible();

  await page.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByRole("heading", { name: "Add milestone" })).toBeVisible();
  await page.locator("#field-name").fill("Pilot kickoff");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Pilot kickoff", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Complete" })).toBeVisible();
});
