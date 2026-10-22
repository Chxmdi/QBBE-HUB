import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { clickWhenInteractive } from "./interactive";

/**
 * A save whose request never reaches the server must not leave its button
 * stuck on "Saving…" with nothing said (useServerAction). The request is
 * aborted in the browser, as a dropped connection would.
 */
test("a create that cannot reach the Hub re-enables its button and says why", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/projects");
  await clickWhenInteractive(page.getByRole("button", { name: "New project" }));
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(`Unreachable ${Date.now()}`);

  // Server actions are POSTs that carry a Next-Action header.
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.abort("internetdisconnected")
      : route.continue(),
  );
  const create = dialog.getByRole("button", { name: "Create project" });
  await create.click();

  await expect(dialog.getByText("Could not reach the Hub. Check your connection, then try again.")).toBeVisible();
  await expect(create).toBeEnabled();
});
