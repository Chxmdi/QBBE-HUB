import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * P0-AUTH-01 / P0-AUTH-04: the identity lifecycle against the real backend —
 * an invitation that admits exactly the person and role it names, a revoked
 * invitation that admits nobody, recovery through a real email, and a
 * deactivation that removes access without erasing who did what.
 *
 * Recovery goes through the local mail catcher rather than a stub. A recovery
 * path that is never sent, delivered and opened is a form, not a recovery path.
 */

const MAILPIT = "http://127.0.0.1:54324";
const PASSWORD = "QaTest!2026";

/** A fresh address per run, so a rerun is not answered by the previous run's invitation. */
function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}@example.com`;
}

async function inviteFromAdmin(page: Page, email: string, role: string) {
  await page.goto("/admin");
  await page.getByRole("button", { name: "Invite user", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Role", { exact: true }).selectOption({ label: role });
  await dialog.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(/Invit/i, { timeout: 15_000 });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

function invitationRow(page: Page, email: string) {
  return page
    .getByRole("region", { name: "Invitations", exact: true })
    .locator("li")
    .filter({ hasText: email });
}

function memberRow(page: Page, email: string) {
  return page
    .getByRole("region", { name: "Members", exact: true })
    .locator("tr")
    .filter({ hasText: email });
}

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
}

/**
 * A real new account arrives at first-run onboarding, not at the workspace.
 * The QA fixture users skip it because their profiles are marked onboarded, so
 * a test that invites somebody genuinely new has to walk it like they would.
 */
async function completeOnboarding(page: Page) {
  for (let step = 0; step < 3; step += 1) {
    const next = page.getByRole("button", { name: /^Continue/ });
    await expect(next).toBeVisible({ timeout: 30_000 });
    await next.click();
  }
  const enter = page.getByRole("button", { name: /^Enter the workspace/ });
  await expect(enter).toBeVisible({ timeout: 30_000 });
  await enter.click();
  await expect(page.getByRole("link", { name: "My Work", exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function joinAsNewPerson(page: Page, name: string, email: string) {
  await signUp(page, name, email);
  await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
  await completeOnboarding(page);
}

/** The most recent message delivered to an address, waited for rather than assumed. */
async function latestMessageTo(page: Page, email: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await page.request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`,
    );
    if (response.ok()) {
      const body = (await response.json()) as { messages?: { ID: string }[] };
      const id = body.messages?.[0]?.ID;
      if (id) {
        const source = await page.request.get(`${MAILPIT}/api/v1/message/${id}`);
        return (await source.json()) as { Text?: string; HTML?: string };
      }
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`No mail arrived for ${email} within 30s`);
}

test.describe("identity lifecycle", () => {
  /**
   * The Hub allows 30 invitations an hour per person
   * (RATE_LIMITS["invitation:create"]), and the counter lives in Postgres so
   * that serverless instances share it. That makes it state this file inherits
   * rather than creates: run the suite a few times inside one hour and the
   * owner is met with "You're doing that too quickly. Try again in about 13
   * minutes." where an invitation should be, and every test that opens with an
   * invitation fails together.
   *
   * The limiter has its own unit tests. Here it is a fixture to reset, so this
   * file gives the same answer on the fourth run of the hour as on the first.
   */
  test.beforeAll(() => {
    sql("delete from rate_limit_counter where bucket like 'invitation:create:%';");
  });

  test("an invitation admits the person and the role it names", async ({ page }) => {
    const email = uniqueEmail("qa-invited");
    await signIn(page, "owner");
    await inviteFromAdmin(page, email, "Volunteer");
    await expect(invitationRow(page, email)).toContainText("pending");

    await signOut(page);
    // Reaching the workspace is the proof the invitation was honoured.
    await joinAsNewPerson(page, "Invited Volunteer", email);

    await signOut(page);
    await signIn(page, "owner");
    await page.goto("/admin");
    const member = memberRow(page, email);
    await expect(member).toBeVisible({ timeout: 15_000 });
    // The role the invitation named, not the default the sign-up form would give.
    await expect(member.getByLabel("Member role")).toHaveValue("volunteer");
    await expect(invitationRow(page, email)).toContainText("accepted");
  });

  test("a revoked invitation admits nobody", async ({ page }) => {
    const email = uniqueEmail("qa-revoked");
    await signIn(page, "owner");
    await inviteFromAdmin(page, email, "Staff");
    await invitationRow(page, email)
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    await expect(invitationRow(page, email)).toContainText("revoked", { timeout: 15_000 });

    await signOut(page);
    await signUp(page, "Revoked Person", email);
    // Scoped to the form's own alert: Next keeps a permanently empty
    // role="alert" route announcer on the page, so an unscoped match is
    // ambiguous rather than wrong.
    await expect(
      page.getByRole("alert").filter({ hasText: "invite-only" }),
    ).toBeVisible({ timeout: 20_000 });
    // Still outside: the refusal has to be the end of it, not a notice on the way in.
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("recovery sends a real email that sets a real password", async ({ page }) => {
    const email = uniqueEmail("qa-recovers");
    const newPassword = "RecoveredPass!2026";
    await signIn(page, "owner");
    await inviteFromAdmin(page, email, "Staff");
    await signOut(page);
    await joinAsNewPerson(page, "Recovering Person", email);
    await signOut(page);

    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send recovery link", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("recovery link", { timeout: 20_000 });

    const message = await latestMessageTo(page, email);
    const link = (message.Text ?? message.HTML ?? "")
      .match(/https?:\/\/\S*?(?=["'\s<]|$)/g)
      ?.find((candidate) => candidate.includes("token"));
    expect(link, "the recovery email must carry a link").toBeTruthy();

    await page.goto(link!);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Save password", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("password has been changed", {
      timeout: 20_000,
    });

    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
  });

  test("deactivation removes access and keeps the record of what they did", async ({ page }) => {
    const stamp = Date.now();
    const email = `qa-leaver-${stamp}@example.com`;
    const taskTitle = `Handover note ${stamp}`;
    // The display name has to be unique too, not just the address. People may
    // legitimately share a name, so the assignee picker offers every match —
    // and on a rerun an earlier run's leaver would be picked instead of this
    // one, sending the task to an account this test is not watching.
    const name = `Departing Staffer ${stamp}`;

    await signIn(page, "owner");
    await inviteFromAdmin(page, email, "Staff");
    await signOut(page);
    await joinAsNewPerson(page, name, email);
    await signOut(page);

    // A task assigned to them, created by the owner. A task belonging to no
    // project and no programme is an administrator's to create, so the staffer
    // cannot make their own — but as the assignee they may work on it, and
    // working on it is what leaves a record in their name.
    await signIn(page, "owner");
    await page.goto("/my-work?create=task");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByLabel("Title", { exact: true }).fill(taskTitle);
    await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: name });
    await dialog.getByRole("button", { name: "Create task", exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    await signOut(page);

    // The staffer moves it, which is the act the history has to remember.
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });

    await page.goto("/board");
    const card = page.locator("article, li").filter({ hasText: taskTitle }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByLabel("Task status").selectOption("in_progress");
    await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible();

    await page.getByText(taskTitle, { exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    const taskLink = page.url();
    await signOut(page);

    await signIn(page, "owner");
    await page.goto("/admin");
    const member = memberRow(page, email);
    // Deactivation asks first. Playwright dismisses native dialogs unless told
    // otherwise, so without this the click is answered "cancel" and the test
    // would be measuring nothing.
    page.once("dialog", (confirmation) => confirmation.accept());
    await member.getByRole("button", { name: "Deactivate", exact: true }).click();
    await expect(member).toContainText("deactivated", { timeout: 15_000 });
    // Still named in the directory: deactivation ends access, it does not
    // erase the person from the record of who did what.
    await expect(member).toContainText(name);

    // And the history of what they did still names them.
    await page.goto(taskLink);
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible({ timeout: 20_000 });
    await expect(drawer.getByText(name).first()).toBeVisible({ timeout: 20_000 });
    await signOut(page);

    // The account itself is shut out, using the password that worked minutes ago.
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("link", { name: "My Work", exact: true })).toHaveCount(0);
  });
});
