import { test, expect } from "./fixtures";
import { signIn } from "./auth";

/**
 * P0-UX-05 / #100: a load that fails after the page renders says so and
 * offers Try again, instead of rendering the empty state. The failures are
 * injected at the network, on the browser's own Supabase requests, then
 * lifted so the retry is shown to recover.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page, "owner");
});

test("a failed notifications load says so, and Try again recovers", async ({ page }) => {
  await page.route("**/rest/v1/notification?**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"injected"}' })
      : route.continue(),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("region", { name: "Notifications" });
  await expect(panel.getByRole("alert")).toContainText("Notifications couldn't be loaded.");
  await expect(panel.getByText("You're all caught up.")).toHaveCount(0);

  await page.unroute("**/rest/v1/notification?**");
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("a failed search says so instead of claiming there are no results", async ({ page }) => {
  await page.route("**/rest/v1/rpc/global_search", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"injected"}' }),
  );
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search" }).fill("workshop");
  await expect(page.getByRole("alert")).toContainText("Search isn't available right now.");
  await expect(page.getByText("No matching records you have access to.")).toHaveCount(0);

  await page.unroute("**/rest/v1/rpc/global_search");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
});
