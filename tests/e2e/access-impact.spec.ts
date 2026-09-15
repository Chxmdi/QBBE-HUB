import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn } from "./auth";

test("owner reviews live access and grant sources", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/admin/access");
  await expect(page.getByRole("heading", { name: "Access impact", exact: true })).toBeVisible();
  await expect(page.getByText(/Live grants are shown below and are already enforced/)).toBeVisible();
  await expect(page.getByText(/It is not an automatic backfill\./)).toBeVisible();
  await expect(page.getByText(/Could not load the complete access inventory/)).toHaveCount(0);

  const members = page.getByRole("region", { name: "Active members", exact: true });
  const owner = members.locator("li.card").filter({
    has: page.getByRole("heading", { name: "QA Owner (owner)", exact: true }),
  });
  const volunteer = members.locator("li.card").filter({
    has: page.getByRole("heading", { name: "QA Volunteer (volunteer)", exact: true }),
  });
  await expect(owner).toBeVisible();
  await expect(volunteer).toBeVisible();
  await expect(owner).toContainText("0 management grants would be removed");

  const details = owner.locator("details").filter({ hasText: "Proposed access and sources" });
  await expect(details).not.toHaveAttribute("open", "");
  const summary = details.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  // Assert real fixture inventory was read, without coupling to record names/counts.
  await expect(details.getByRole("listitem").filter({ hasText: /^program:/ }).first()).toBeVisible();
  await expect(details.getByRole("listitem").filter({ hasText: /^project:/ }).first()).toBeVisible();
  await expect(details.getByRole("listitem").first()).toContainText("organization administrator");

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(value => {
      localStorage.setItem("qbbe-theme", value);
      document.documentElement.classList.toggle("dark", value === "dark");
    }, theme);
    // Text colors transition for 120ms while the page background changes
    // immediately. Audit the settled theme rather than that transient frame.
    await page.waitForTimeout(200);
    const result = await new AxeBuilder({ page }).analyze();
    const violations = result.violations.filter(v => v.impact === "critical" || v.impact === "serious");
    expect(violations, `${theme} theme: ${JSON.stringify(violations)}`).toEqual([]);
  }
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).not.toHaveAttribute("open", "");
});

test("volunteer cannot access the administrator access inventory", async ({ page }) => {
  await signIn(page, "volunteer");
  const response = await page.goto("/admin/access");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Access impact", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Active members", exact: true })).toHaveCount(0);
  await expect(page.getByText("Proposed access and sources", { exact: true })).toHaveCount(0);
  // Also guard against inventory accidentally serialized into the denied response.
  expect(await response?.text()).not.toContain("proposed readable records of");
});
