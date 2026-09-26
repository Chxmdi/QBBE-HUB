import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * French interface (#141): the language can be chosen before sign-in, follows
 * the browser when nothing is chosen, and — once saved on the profile — turns
 * the shell and the high-traffic screens French with a matching <html lang>.
 *
 * English stays the default, which is why every other spec can keep selecting
 * by English text. This one resets the volunteer's language when it finishes
 * so it cannot leak into them.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test.describe("before sign-in", () => {
  test("the sign-in screen switches to French and back", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

    await clickWhenInteractive(page.getByRole("button", { name: "Français", exact: true }));
    await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
    await expect(page.getByLabel("Courriel", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Mot de passe oublié?" })).toBeVisible();

    // The axe sweep in French, including the document language.
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);

    await clickWhenInteractive(page.getByRole("button", { name: "English", exact: true }));
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("a French browser with no saved choice", () => {
  test.use({ locale: "fr-CA" });

  test("gets the French sign-in screen", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
    await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeVisible();
  });
});

test.describe("a signed-in person who chooses French", () => {
  const resetVolunteer = () =>
    sql(
      "update public.user_profile set locale = null where email = 'qa-volunteer@example.com';",
    );

  test.beforeEach(resetVolunteer);
  test.afterEach(resetVolunteer);

  test("sees the shell and main screens in French", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "volunteer");

    await page.goto("/settings");
    await clickWhenInteractive(page.getByRole("radio", { name: "Français" }));

    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
    await expect(nav.getByRole("link", { name: "Mon travail" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Accueil", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paramètres", level: 1 })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Français" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Menu du compte" })).toBeVisible();

    // The choice is on the profile, so it holds on a fresh page load.
    await page.goto("/my-work");
    await expect(page.getByRole("heading", { name: "Mon travail", level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");

    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Boîte de réception", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Filtres de la boîte de réception" })).toBeVisible();

    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /^(Bonjour|Bon après-midi|Bonsoir)/ }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.filter((v) => v.id.includes("lang"))).toEqual([]);

    // And back: English is one click away and applies at once.
    await page.goto("/settings");
    await clickWhenInteractive(page.getByRole("radio", { name: "English" }));
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
