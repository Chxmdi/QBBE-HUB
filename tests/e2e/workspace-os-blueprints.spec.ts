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
const GRANTS_KEY = `e2e_hiring_grants_${Date.now().toString(36)}`;

/** Type keys this file's blueprints build; building now creates real structure rows. */
const TYPE_KEYS = ["opening", "candidate", "application", "report"];

/**
 * Removes this file's blueprints, builds first (a built blueprint cannot be
 * deleted), then the types, properties and relations those builds created
 * (deleting a type removes its properties; relations go first).
 */
function cleanUp() {
  const keys = TYPE_KEYS.map((k) => `'${k}'`).join(", ");
  sql(`
    delete from public.blueprint_build where blueprint_id in (select id from public.blueprint where key like 'e2e\\_hiring\\_%' or key like 'new\\_blueprint%');
    update public.blueprint set status = 'draft', approved_hash = null, approved_by = null, approved_at = null where key like 'e2e\\_hiring\\_%' or key like 'new\\_blueprint%';
    delete from public.blueprint where key like 'e2e\\_hiring\\_%' or key like 'new\\_blueprint%';
    delete from public.relation_type where not is_native and (from_type_id in (select id from public.object_type where kind = 'custom' and key in (${keys})) or to_type_id in (select id from public.object_type where kind = 'custom' and key in (${keys})));
    delete from public.object_type where kind = 'custom' and key in (${keys});
  `);
}

async function noSeriousViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(violations, `${label}: ${JSON.stringify(violations)}`).toEqual([]);
}

test.beforeAll(() => {
  sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
  cleanUp();
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
  // Building now creates the real types and properties.
  expect(sql("select count(*) from public.object_type where kind = 'custom' and key in ('opening', 'candidate') and archived_at is null;")).toBe("2");
  expect(sql("select kind from public.property_definition p join public.object_type t on t.id = p.type_id where t.key = 'opening' and p.key = 'stage' and p.archived_at is null;")).toBe("status");
  await noSeriousViolations(page, "built");

  await page.getByRole("button", { name: "Undo build" }).click();
  await page.getByRole("group", { name: "Undo build" }).getByRole("button", { name: "Undo build" }).click();
  await expect(page.getByText("Build undone. The blueprint is a draft again.")).toBeVisible();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Draft");
  expect(sql(`select count(*) from public.blueprint_build b join public.blueprint p on p.id = b.blueprint_id where p.key = '${KEY}' and b.undone_at is null;`)).toBe("0");
  // Undo removed (archived) what the build created.
  expect(sql("select count(*) from public.object_type where kind = 'custom' and key in ('opening', 'candidate') and archived_at is null;")).toBe("0");
});

test("a blueprint with a formula and a rollup validates, builds and undoes [switches on]", async ({ page }) => {
  test.slow();
  await signIn(page, "owner");
  await page.goto("/builder");
  await page.getByRole("button", { name: "New blueprint" }).click();
  await page.waitForURL(/\/builder\/[0-9a-f-]{36}$/);
  await page.getByLabel("Name (English)", { exact: true }).fill("Grants");
  await page.getByLabel("Name (French)", { exact: true }).fill("Subventions");
  await page.getByLabel("Key", { exact: true }).fill(GRANTS_KEY);

  // Two types: an Application that gets a formula and a rollup, and the Reports it rolls up.
  await page.getByLabel("Type name (English)").first().fill("Application");
  await page.getByLabel("Type name (French)").first().fill("Demande");
  await page.getByRole("button", { name: "Add type" }).first().click();
  await page.getByLabel("Type name (English)").nth(1).fill("Report");
  await page.getByLabel("Type name (French)").nth(1).fill("Rapport");
  await page.getByRole("button", { name: "Connect Report" }).click();
  await page.getByRole("button", { name: "Connect Application" }).click();
  await expect(page.getByRole("group", { name: "Report relates to Application" })).toBeVisible();

  const report = page.getByRole("group", { name: "Type 2: Report" });
  await page.getByRole("button", { name: "Add property (Report)" }).click();
  await report.getByLabel("Property name (English)").fill("Hours");
  await report.getByLabel("Property name (French)").fill("Heures");
  await report.getByLabel("Kind").selectOption("number");

  const application = page.getByRole("group", { name: "Type 1: Application" });
  await page.getByRole("button", { name: "Add property (Application)" }).click();
  await application.getByLabel("Property name (English)").nth(0).fill("Requested");
  await application.getByLabel("Property name (French)").nth(0).fill("Demandé");
  await application.getByLabel("Kind").nth(0).selectOption("currency");

  // The formula checks itself as it is typed, in plain words, then shows a worked example.
  await page.getByRole("button", { name: "Add property (Application)" }).click();
  await application.getByLabel("Property name (English)").nth(1).fill("Double");
  await application.getByLabel("Property name (French)").nth(1).fill("Double");
  await application.getByLabel("Kind").nth(1).selectOption("formula");
  const status = page.getByTestId("formula-status");
  await expect(status).toHaveText("Write the formula.");
  await application.getByLabel("Formula", { exact: true }).fill('prop("Nope") * 2');
  await expect(status).toHaveText("There is no property called “Nope”.");
  await expect(page.getByText("1 problems to fix")).toBeVisible();
  await application.getByLabel("Formula", { exact: true }).fill('prop("Requested") * 2');
  await expect(status).toHaveText("Example: with Requested = 1,250.5 → 2,501");
  await expect(page.getByText(/problems to fix/)).toHaveCount(0);

  await page.getByRole("button", { name: "Add property (Application)" }).click();
  await application.getByLabel("Property name (English)").nth(2).fill("Reports");
  await application.getByLabel("Property name (French)").nth(2).fill("Rapports");
  await application.getByLabel("Kind").nth(2).selectOption("relation");

  await page.getByRole("button", { name: "Add property (Application)" }).click();
  await application.getByLabel("Property name (English)").nth(3).fill("Hours total");
  await application.getByLabel("Property name (French)").nth(3).fill("Total des heures");
  await application.getByLabel("Kind").nth(3).selectOption("rollup");
  await application.getByLabel("Over relation property").selectOption("reports");
  await application.getByLabel("Calculation").selectOption("sum");
  await expect(page.getByText(/problems to fix/)).toBeVisible();
  await application.getByLabel("Property to summarise").selectOption("hours");
  await expect(page.getByText(/problems to fix/)).toHaveCount(0);
  await noSeriousViolations(page, "formula and rollup design");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.getByRole("tab", { name: "Approve and build" }).click();
  await page.getByRole("button", { name: "Approve blueprint" }).click();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Approved");
  await page.getByRole("button", { name: "Build now" }).click();
  await page.getByRole("group", { name: "Build now" }).getByRole("button", { name: "Build now" }).click();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Built");

  // Real rows: the formula keeps its expression, the rollup was made by the database's own function.
  const properties = "select p.key || ':' || p.kind from public.property_definition p join public.object_type t on t.id = p.type_id where t.key = 'application' and p.archived_at is null order by p.position";
  expect(sql(`${properties};`)).toBe("requested:currency\ndouble:formula\nreports:relation\nhours_total:rollup");
  expect(sql("select p.options->>'expression' from public.property_definition p join public.object_type t on t.id = p.type_id where t.key = 'application' and p.key = 'double';")).toBe('prop("Requested") * 2');
  expect(sql("select p.options->>'function' || '/' || (p.options->>'targetProperty') from public.property_definition p join public.object_type t on t.id = p.type_id where t.key = 'application' and p.key = 'hours_total';")).toBe("sum/hours");
  expect(sql("select count(*) from public.relation_type where key = 'report_application' and archived_at is null;")).toBe("1");

  await page.getByRole("button", { name: "Undo build" }).click();
  await page.getByRole("group", { name: "Undo build" }).getByRole("button", { name: "Undo build" }).click();
  await expect(page.getByText("Build undone. The blueprint is a draft again.")).toBeVisible();
  expect(sql("select count(*) from public.property_definition p join public.object_type t on t.id = p.type_id where t.key in ('application', 'report') and p.archived_at is null;")).toBe("0");
  expect(sql("select count(*) from public.object_type where key in ('application', 'report') and archived_at is null;")).toBe("0");
  expect(sql("select count(*) from public.relation_type where key = 'report_application' and archived_at is null;")).toBe("0");
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
