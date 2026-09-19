import { expect, test } from "@playwright/test";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Acceptance evidence for #26 (P0-PROG-01, P0-PROG-02).
 *
 * The parts that can only be shown in a browser: that a stored value is
 * actually rendered rather than merely saved, and that changing the lead moves
 * real capability from one person to another.
 */

async function createProgram(page: import("@playwright/test").Page, name: string) {
  await page.goto("/programs?create=1");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create program", exact: true }).click();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/, { timeout: 60_000 });
}

test("a program's colour and links survive a save and are actually shown", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const name = `Program overview ${Date.now()}`;
  await createProgram(page, name);

  await page.getByRole("button", { name: "Edit program" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit program" });
  await dialog.getByLabel("Colour", { exact: true }).selectOption("green");
  await dialog
    .getByLabel("Important links", { exact: true })
    // The second line is not http(s) and must not survive: these render as
    // anchors, so storing it would be stored XSS.
    .fill("Program handbook|https://qbbe.ca/handbook\nBad|javascript:alert(1)");
  await dialog.getByRole("button", { name: "Save program" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  // Re-read from the server rather than trusting the optimistic view.
  await page.reload();
  const handbook = page.getByRole("link", { name: "Program handbook", exact: true });
  await expect(handbook).toBeVisible({ timeout: 30_000 });
  await expect(handbook).toHaveAttribute("href", "https://qbbe.ca/handbook");
  await expect(page.getByRole("link", { name: "Bad", exact: true })).toHaveCount(0);

  // The colour round-trips through the form rather than silently resetting.
  await page.getByRole("button", { name: "Edit program" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit program" }).getByLabel("Colour", { exact: true }),
  ).toHaveValue("green");
});

test("changing the program lead moves who can manage it", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const name = `Program lead ${Date.now()}`;
  await createProgram(page, name);
  const programUrl = page.url();

  // A volunteer holds nothing on this program to begin with.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(programUrl);
  await expect(page.getByRole("button", { name: "Edit program" })).toHaveCount(0);

  // Hand them the lead role.
  await signOut(page);
  await signIn(page, "owner");
  await page.goto(programUrl);
  await page.getByRole("button", { name: "Edit program" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit program" });
  await dialog.getByLabel("Program lead", { exact: true }).selectOption({ label: "QA Volunteer" });
  await dialog.getByRole("button", { name: "Save program" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  // The lead is capability, not decoration: they can now manage the program.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(programUrl);
  await expect(page.getByRole("button", { name: "Edit program" })).toBeVisible({
    timeout: 30_000,
  });
});

test("the program overview shows the team and the latest project update", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // The seeded programme already has projects and a published status update,
  // which is what makes this assertion about composition rather than fixtures.
  await page.goto("/programs");
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Family First", exact: true }) })
    .click();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]+$/, { timeout: 60_000 });

  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Latest updates", exact: true }),
  ).toBeVisible();

  // The owner holds the programme through being its lead, so the team panel
  // must not be empty on a programme that plainly has one.
  const team = page.getByRole("region", { name: "Team" });
  await expect(team.getByText("QA Owner", { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test("a volunteer cannot reach a program they hold nothing on", async ({ page }) => {
  test.setTimeout(180_000);
  const id = sql("select id::text from program where name = 'Family First' limit 1");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  await signIn(page, "volunteer");
  await page.goto(`/programs/${id}`);
  // RLS returns no row, so the page is a not-found rather than a redirect.
  await expect(page.getByRole("button", { name: "Edit program" })).toHaveCount(0);
  await expect(page.getByText("Latest updates", { exact: true })).toHaveCount(0);
});
