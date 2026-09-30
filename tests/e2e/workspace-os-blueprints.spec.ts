import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Blueprint designer (V2-2), behind the `wos_objects` switch: draw two types
 * with the keyboard, connect them on the canvas, preview, approve, build as one
 * change set and undo it. The switch is turned on for this file only.
 */

const KEY = `e2e_hiring_${Date.now().toString(36)}`;

/** Removes this file's blueprints, builds first (a built blueprint cannot be deleted). */
function cleanUp() {
  sql(`
    delete from public.blueprint_build where blueprint_id in (select id from public.blueprint where key like 'e2e\\_hiring\\_%' or key like 'new\\_blueprint%');
    update public.blueprint set status = 'draft', approved_hash = null, approved_by = null, approved_at = null where key like 'e2e\\_hiring\\_%' or key like 'new\\_blueprint%';
    delete from public.blueprint where key like 'e2e\\_hiring\\_%' or key like 'new\\_blueprint%';
  `);
}

async function noSeriousViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(violations, `${label}: ${JSON.stringify(violations)}`).toEqual([]);
}

test.beforeAll(() => {
  sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
});

test.afterAll(() => {
  cleanUp();
  sql("update public.feature_flag set enabled = false where key = 'wos_objects' and organization_id is null;");
});

test("owner draws, previews, approves, builds and undoes a blueprint", async ({ page }) => {
  test.slow();
  await signIn(page, "owner");
  await page.goto("/builder");
  await expect(page.getByRole("heading", { name: "Blueprints", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New blueprint" }).click();
  await page.waitForURL(/\/builder\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("blueprint-status")).toHaveText("Draft");

  // Everything below uses labelled fields, the canvas's keyboard equivalent.
  await page.getByLabel("Name (English)", { exact: true }).fill("Hiring");
  await page.getByLabel("Name (French)", { exact: true }).fill("Embauche");
  await page.getByLabel("Key", { exact: true }).fill(KEY);

  await page.getByLabel("Type name (English)").first().fill("Opening");
  await page.getByLabel("Type name (French)").first().fill("Poste");
  await page.getByRole("button", { name: "Add property (Opening)" }).click();
  await page.getByLabel("Property name (English)").fill("Stage");
  await page.getByLabel("Property name (French)").fill("Étape");
  await page.getByLabel("Kind").selectOption("status");
  await page.getByLabel("Choices, one per line (English | French)").fill("Open | Ouvert\nFilled | Pourvu");

  await page.getByRole("button", { name: "Add type" }).first().click();
  await page.getByLabel("Type name (English)").nth(1).fill("Candidate");
  await page.getByLabel("Type name (French)").nth(1).fill("Candidat");

  // The canvas: move a card with the arrow keys, then connect two types.
  const card = page.getByTestId("canvas-type-item");
  const before = await card.evaluate((el) => (el as HTMLElement).style.left);
  await card.getByRole("button", { name: /^Opening\./ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => card.evaluate((el) => (el as HTMLElement).style.left)).not.toBe(before);
  await page.getByRole("button", { name: "Connect Candidate" }).click();
  await expect(page.getByText("Connecting from Candidate.")).toBeVisible();
  await page.getByRole("button", { name: "Connect Opening" }).click();
  await expect(page.getByRole("group", { name: "Candidate relates to Opening" })).toBeVisible();

  await expect(page.getByText(/problems to fix/)).toHaveCount(0);
  await noSeriousViolations(page, "design");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByText("Opening by Stage")).toBeVisible();
  await expect(page.getByTestId("preview-total")).toContainText("items in one change set");
  await noSeriousViolations(page, "preview");

  await page.getByRole("tab", { name: "Approve and build" }).click();
  await page.getByRole("button", { name: "Approve blueprint" }).click();
  await expect(page.getByText("Approved. You can build it now.")).toBeVisible();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Approved");

  await page.getByRole("button", { name: "Build now" }).click();
  await page.getByRole("group", { name: "Build now" }).getByRole("button", { name: "Build now" }).click();
  await expect(page.getByText(/^Built\. \d+ items were created as one change set\.$/)).toBeVisible();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Built");
  expect(sql(`select count(*) from public.blueprint_build b join public.blueprint p on p.id = b.blueprint_id where p.key = '${KEY}' and b.undone_at is null;`)).toBe("1");
  await noSeriousViolations(page, "built");

  await page.getByRole("button", { name: "Undo build" }).click();
  await page.getByRole("group", { name: "Undo build" }).getByRole("button", { name: "Undo build" }).click();
  await expect(page.getByText("Build undone. The blueprint is a draft again.")).toBeVisible();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Draft");
  expect(sql(`select count(*) from public.blueprint_build b join public.blueprint p on p.id = b.blueprint_id where p.key = '${KEY}' and b.undone_at is null;`)).toBe("0");
});

test("staff can look but not change; volunteers and a switched-off module see nothing", async ({ page }) => {
  await signIn(page, "staff");
  await page.goto("/builder");
  await expect(page.getByText("Only owners and admins can change blueprints.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New blueprint" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, "volunteer");
  await page.goto("/builder");
  await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Blueprints" })).toHaveCount(0);
  await signOut(page);

  sql("update public.feature_flag set enabled = false where key = 'wos_objects' and organization_id is null;");
  try {
    await signIn(page, "staff");
    await page.goto("/builder");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  } finally {
    sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
  }
});

test("the designer reads in French", async ({ page, context }) => {
  await signIn(page, "owner");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/builder");
  await expect(page.getByRole("heading", { name: "Plans de l’espace", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nouveau plan" })).toBeVisible();
  await noSeriousViolations(page, "French list");
});
