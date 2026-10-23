import { expect, test, type Page, type Route } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * A person can start typing before the page's scripts have run: on a slow
 * phone, a sign-in form is visible well before it works. What they type must
 * still be there once the page takes over, and the button must say it is not
 * ready yet rather than eat the click. Before this, the sign-in form reset
 * the email to empty when its scripts loaded, and the submit then did
 * nothing at all, without a word.
 *
 * The page's scripts are held back here until the typing is done, so the
 * typing happens, deliberately, before the page works.
 */

async function holdScripts(page: Page) {
  const held: Route[] = [];
  let releasing = false;
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (releasing) return route.continue();
    held.push(route);
  });
  return async () => {
    releasing = true;
    for (const route of held.splice(0)) await route.continue();
  };
}

test("text typed into sign-in before the page's scripts run is kept, and sign-in then works", async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });

  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await email.fill("qa-staff@example.com");
  await password.fill("QaTest!2026");
  // Not ready yet, and visibly so: a click now would have gone nowhere.
  await expect(submit).toBeDisabled();

  await release();
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await expect(email).toHaveValue("qa-staff@example.com");
  await expect(password).toHaveValue("QaTest!2026");
  await submit.click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
});

test("a password reset requested before the page's scripts run keeps its address", async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
  const email = page.getByLabel("Email", { exact: true });
  const submit = page.getByRole("button", { name: "Send recovery link" });
  await email.fill("qa-staff@example.com");
  await expect(submit).toBeDisabled();
  await release();
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await expect(email).toHaveValue("qa-staff@example.com");
  // Never sent in the address bar by a submit the page could not handle.
  expect(page.url()).not.toContain("qa-staff");
});

test("the welcome form waits for the page before it can be sent, and keeps what was typed", async ({ page }) => {
  const volunteer = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
  const onboarded = sql(`select coalesce(onboarded_at::text, '') from public.user_profile where id = '${volunteer}';`).trim();
  await signIn(page, "volunteer");
  sql(`update public.user_profile set onboarded_at = null where id = '${volunteer}';`);
  try {
    const release = await holdScripts(page);
    await page.goto("/welcome", { waitUntil: "domcontentloaded" });
    const name = page.getByLabel("Full name", { exact: true });
    const submit = page.getByRole("button", { name: "Continue" });
    await name.fill("Rae Volunteer");
    await expect(submit).toBeDisabled();
    await release();
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await expect(name).toHaveValue("Rae Volunteer");
    // Never sent by the browser with the fields in the address bar.
    expect(page.url()).not.toContain("Rae");
  } finally {
    sql(`update public.user_profile set onboarded_at = ${onboarded ? `'${onboarded}'` : "now()"} where id = '${volunteer}';`);
  }
});
