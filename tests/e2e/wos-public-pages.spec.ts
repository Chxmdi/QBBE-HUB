import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Public pages (V1-18, epic #199): an owner asks, a different admin reviews
 * what exactly will be published, a signed-out visitor reads only the copy,
 * and unpublishing takes it down at once. Behind `wos_public_pages` (and
 * `wos_spaces` for the spaces list), turned on for these tests only.
 */

function setSwitches(enabled: boolean) {
  sql(`update feature_flag set enabled = ${enabled} where key in ('wos_spaces', 'wos_public_pages') and organization_id is null`);
}

test.describe("public pages", () => {
  test.afterEach(() => setSwitches(false));

  test("ask, review, publish, read signed out, unpublish", async ({ page, browser }) => {
    test.setTimeout(180_000);
    setSwitches(true);
    const stamp = Date.now();
    const name = `Gala ${stamp}`;
    const slug = `gala-${stamp}`;
    const orgId = sql(
      `select organization_id::text from organization_membership m join user_profile p on p.id = m.user_id where p.email = 'qa-owner@example.com'`,
    );
    const spaceId = sql(
      `insert into space (organization_id, kind, name_en, name_fr, description) values ('${orgId}', 'custom', '${name}', 'Gala FR ${stamp}', 'Join us on May 3.') returning id`,
    );
    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    try {
      // The owner asks, choosing the description too.
      await signIn(page, "owner");
      await page.goto("/spaces/publish");
      await page.getByLabel("What to publish").selectOption({ label: name });
      await page.getByRole("button", { name: "Choose fields" }).click();
      const ask = page.getByRole("region", { name: "Ask to publish" });
      await ask.getByRole("checkbox", { name: /Description/ }).check();
      await ask.getByLabel("Web address").fill(slug);
      await ask.getByRole("button", { name: "Send for review" }).click();
      await expect(ask.getByRole("status")).toHaveText(/Sent for review/);

      const waiting = page.getByRole("region", { name: "Waiting for review" }).getByRole("listitem").filter({ hasText: slug });
      await expect(waiting).toContainText("Join us on May 3.");
      await expect(waiting).toContainText("another owner or administrator must review it");

      // Not public yet.
      await visitorPage.goto(`/p/${slug}`);
      await expect(visitorPage.getByRole("heading", { name })).toHaveCount(0);

      // A different admin approves after seeing the preview.
      await signOut(page);
      await signIn(page, "admin");
      await page.goto("/spaces/publish");
      const review = page.getByRole("region", { name: "Waiting for review" }).getByRole("listitem").filter({ hasText: slug });
      await expect(review.getByText("What will be published")).toBeVisible();
      await review.getByRole("button", { name: "Approve and publish" }).click();
      await expect(page.getByRole("region", { name: "Published" }).getByRole("link", { name: `/p/${slug}` })).toBeVisible();

      // A signed-out visitor reads the copy, in both languages.
      await visitorPage.goto(`/p/${slug}`);
      await expect(visitorPage.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expect(visitorPage.getByText("Join us on May 3.")).toBeVisible();
      const axe = await new AxeBuilder({ page: visitorPage }).analyze();
      const serious = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      await visitor.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(visitorPage.url()).origin }]);
      await visitorPage.reload();
      await expect(visitorPage.getByRole("heading", { name: `Gala FR ${stamp}`, level: 1 })).toBeVisible();
      await expect(visitorPage.getByText(/Publiée le/)).toBeVisible();

      // Members see the "Public" badge where the space appears.
      await page.goto("/spaces");
      await expect(page.getByRole("listitem").filter({ hasText: name })).toContainText("Public");

      // Unpublish: gone at once.
      await page.goto("/spaces/publish");
      await page.getByRole("button", { name: `Unpublish — /p/${slug}` }).click();
      await expect(page.getByRole("region", { name: "Published" }).getByRole("link", { name: `/p/${slug}` })).toHaveCount(0);
      await visitorPage.goto(`/p/${slug}`);
      await expect(visitorPage.getByRole("heading", { name: `Gala FR ${stamp}` })).toHaveCount(0);
    } finally {
      await visitor.close();
      sql(`delete from space where id = '${spaceId}'`);
    }
  });

  test("staff cannot open the publishing screen", async ({ page }) => {
    setSwitches(true);
    await signIn(page, "staff");
    await page.goto("/spaces/publish");
    await expect(page).toHaveURL(/\/\?denied=1$/);
  });

  test("an unknown address is not found for a visitor", async ({ page }) => {
    setSwitches(true);
    const response = await page.goto("/p/no-such-page-here");
    await expect(page).toHaveURL(/\/p\/no-such-page-here$/);
    expect(response?.status()).toBe(404);
    // The site's own not-found page (src/app/not-found.tsx), not Next.js's default.
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  });
});
