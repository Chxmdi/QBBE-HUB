import { expect, test } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { signIn, signOut } from "./auth";

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

/**
 * Every staff-only entry in config/navigation.ts, opened by address rather than
 * by link. Hiding a link decides what a volunteer is shown, not what they can
 * reach, and Reports enforced only the hiding: typing the address produced the
 * page, with a Generate report button on it.
 */
test("staff-only surfaces are closed to a volunteer who types the address", async ({
  page,
}) => {
  await signIn(page, "volunteer");
  for (const path of ["/crm", "/reports"]) {
    await page.goto(path);
    await expect(page, `${path} must not render for a volunteer`).toHaveURL(/\/$/);
  }
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate report" })).toHaveCount(0);
});

/**
 * Acceptance evidence for #24 (P0-AUTH-02/03): a scoped grant is what opens a
 * record, and removing it closes the record again. Both halves are read from a
 * second person's own session, so what is proved is the database's answer, not
 * the administrator's screen.
 */
test("a direct grant opens a project for one person, and revoking it closes it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const projectName = `Access round trip ${Date.now()}`;

  await signIn(page, "owner");
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create project" });
  await create.getByLabel("Name", { exact: true }).fill(projectName);
  await create.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const projectUrl = new URL(page.url()).pathname;

  // Before any grant: the volunteer has no path to this record at all. A denied
  // record is absent, not merely unlabelled — so the name must not appear even
  // in the response body.
  await signOut(page);
  await signIn(page, "volunteer");
  const denied = await page.goto(projectUrl);
  await expect(
    page.getByRole("heading", { name: "Not found — or not yours to see" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(await denied?.text()).not.toContain(projectName);
  await page.goto("/projects");
  await expect(page.getByText(projectName, { exact: true })).toHaveCount(0);

  await signOut(page);
  await signIn(page, "owner");
  await page.goto("/admin/access");
  const projectAccess = page
    .locator("div.card")
    .filter({ has: page.getByRole("heading", { name: "Project access", exact: true }) });
  await projectAccess.getByLabel("Member", { exact: true }).selectOption({ label: "QA Volunteer" });
  await projectAccess.getByLabel("Project", { exact: true }).selectOption({ label: projectName });
  await projectAccess.getByLabel("Role", { exact: true }).selectOption("read_only");
  await projectAccess.getByRole("button", { name: "Save project access", exact: true }).click();
  const grantRow = projectAccess
    .getByRole("listitem")
    .filter({ hasText: `QA Volunteer · ${projectName} · read only` });
  await expect(grantRow).toBeVisible({ timeout: 30_000 });

  // The grant is the whole reason the record opens.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(projectUrl);
  await expect(
    page.getByRole("heading", { name: projectName, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  // read_only carries read and follow, and nothing else: no stage control.
  await expect(page.getByLabel("Project stage")).toHaveCount(0);
  await page.goto("/projects");
  await expect(page.getByText(projectName, { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, "owner");
  await page.goto("/admin/access");
  await projectAccess
    .getByRole("listitem")
    .filter({ hasText: `QA Volunteer · ${projectName} · read only` })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(
    projectAccess.getByRole("listitem").filter({ hasText: projectName }),
  ).toHaveCount(0, { timeout: 30_000 });

  // Revocation takes effect on the next request, without waiting for a session
  // to expire.
  await signOut(page);
  await signIn(page, "volunteer");
  const revoked = await page.goto(projectUrl);
  await expect(
    page.getByRole("heading", { name: "Not found — or not yours to see" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(await revoked?.text()).not.toContain(projectName);
  await page.goto("/projects");
  await expect(page.getByText(projectName, { exact: true })).toHaveCount(0);
});
