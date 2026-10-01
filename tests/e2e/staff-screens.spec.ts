import { expect, test } from "./fixtures";
import { signIn } from "./auth";

/**
 * Hardening (epic #18): the screens the menu marks as staff's are staff's at
 * the server too. A volunteer who types the address lands on Home with the
 * "not yours to see" message; staff open them as before.
 */
const SCREENS = ["/api-tokens", "/collab/layouts", "/upkeep"];

test("a volunteer is sent home from the staff screens [switches on]", async ({ page }) => {
  await signIn(page, "volunteer");
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/\?denied=1$/);
  }
});

test("staff open the staff screens [switches on]", async ({ page }) => {
  await signIn(page, "staff");
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
    await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
  }
});
