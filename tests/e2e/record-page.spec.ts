import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS U14: any object as a page, drawn from its type's layout, with
 * editable properties that write through object.set_property. Behind the
 * `wos_objects` switch, turned on for these tests.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

interface Fixture {
  objectId: string;
  typeKey: string;
  title: string;
}

/**
 * A custom "Grant" type with an amount, a note, a formula over the amount and
 * a property only owners and admins may see; one grant the volunteer may view.
 */
function createGrant(): Fixture {
  const suffix = randomUUID().slice(0, 8);
  const typeKey = `rp_grant_${suffix}`;
  const title = `Record page ${suffix}`;
  sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
  const objectId = sql(`
    with org as (select organization_id from public.organization_membership where user_id = '${OWNER}' limit 1),
    typ as (
      insert into public.object_type (organization_id, key, name_en, name_fr, kind)
      select organization_id, '${typeKey}', 'Grant', 'Subvention', 'custom' from org returning id, organization_id
    ),
    defs as (
      insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, options, visible_to_roles, position)
      select typ.organization_id, typ.id, d.key, d.en, d.fr, d.kind, d.options::jsonb, d.roles::public.org_role[], d.position
      from typ, (values
        ('amount', 'Amount', 'Montant', 'currency', '{}', null, 1),
        ('notes', 'Notes', 'Notes', 'text', '{}', null, 2),
        ('doubled', 'Doubled', 'Doublé', 'formula', '{"expression": "prop(\\"amount\\") * 2"}', null, 3),
        ('board_notes', 'Board notes', 'Notes du conseil', 'text', '{}', '{owner,admin}', 4)
      ) as d (key, en, fr, kind, options, roles, position)
      returning id, key, organization_id
    ),
    obj as (
      insert into public.object (organization_id, type_id, title, owner_id, created_by)
      select typ.organization_id, typ.id, '${title}', '${OWNER}', '${OWNER}' from typ returning id, organization_id
    ),
    vals as (
      insert into public.property_value (object_id, property_id, organization_id, value_number, value_text)
      select obj.id, defs.id, obj.organization_id,
             case when defs.key = 'amount' then 1250 end,
             case when defs.key = 'board_notes' then 'Board only ${suffix}' end
      from obj join defs on defs.key in ('amount', 'board_notes')
      returning object_id
    ),
    grant_view as (
      insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id)
      select obj.organization_id, obj.id, 'person', '${VOLUNTEER}',
             (select id from public.access_role where key = 'viewer' and organization_id is null)
      from obj returning id
    )
    select id from obj;
  `);
  return { objectId, typeKey, title };
}

test("a custom property is edited on the record page and recorded in a change set that can be undone [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  const grant = createGrant();

  await signIn(page, "owner");
  await page.goto(`/objects/${grant.objectId}`);
  await expect(page.getByRole("heading", { level: 1, name: grant.title })).toBeVisible();
  const properties = page.getByRole("region", { name: "Properties" });
  await expect(properties).toBeVisible();
  await expect(properties.getByRole("spinbutton", { name: "Amount" })).toHaveValue("1250");

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 1)).toEqual([]);

  // Edit by keyboard only: type into Notes and press Enter to save.
  const notes = properties.getByRole("textbox", { name: "Notes", exact: true });
  await notes.focus();
  await page.keyboard.type("Call the foundation in May");
  await page.keyboard.press("Enter");
  await expect(properties.getByTestId("property-notes").getByRole("status")).toHaveText(/Saved\./);

  // Stored, and recorded as one change set of the object.set_property action.
  expect(
    sql(`select v.value_text from public.property_value v join public.property_definition d on d.id = v.property_id
         where v.object_id = '${grant.objectId}' and d.key = 'notes'`),
  ).toBe("Call the foundation in May");
  const changeSets = sql(`
    select count(*) from public.change_set c join public.change_set_item i on i.change_set_id = c.id
    where c.action_key = 'object.set_property' and i.object_id = '${grant.objectId}' and i.property = 'notes'
      and i.kind = 'update' and i.after = '"Call the foundation in May"'::jsonb and c.undo_of is null`);
  expect(changeSets).toBe("1");

  // Undo from the saved line.
  await properties.getByTestId("property-notes").getByRole("button", { name: "Undo" }).click();
  await expect(properties.getByTestId("property-notes").getByRole("status")).toHaveText("Change undone.");
  await expect(properties.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("");
  expect(
    sql(`select count(*) from public.property_value v join public.property_definition d on d.id = v.property_id
         where v.object_id = '${grant.objectId}' and d.key = 'notes'`),
  ).toBe("0");
  expect(
    sql(`select count(*) from public.change_set c where c.action_key = 'object.set_property' and c.undo_of in (
           select c2.id from public.change_set c2 join public.change_set_item i on i.change_set_id = c2.id
           where i.object_id = '${grant.objectId}' and i.property = 'notes')`),
  ).toBe("1");
});

test("a formula value shows on the record page [switches on]", async ({ page }) => {
  const grant = createGrant();

  await signIn(page, "owner");
  await page.goto(`/objects/${grant.objectId}`);
  const doubled = page.getByRole("region", { name: "Properties" }).getByTestId("property-doubled");
  await expect(doubled).toContainText("2,500");
  // Calculated, so it is read-only, and says why on request.
  await expect(page.getByRole("region", { name: "Properties" }).getByRole("button", { name: "Save Doubled" })).toHaveCount(0);
  const why = doubled.locator("..").getByRole("button", { name: "Why can this not be edited?" });
  await why.focus();
  await expect(doubled.locator("..").getByRole("tooltip")).toContainText("Calculated from a formula");

  // Changing the input recalculates it.
  const amount = page.getByRole("spinbutton", { name: "Amount" });
  await amount.fill("2000");
  await page.getByRole("button", { name: "Save Amount" }).click();
  await expect(page.getByTestId("property-amount").getByRole("status")).toHaveText(/Saved\./);
  await expect(doubled).toContainText("4,000");

  // French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
  await page.reload();
  const french = page.getByRole("region", { name: "Propriétés" });
  await expect(french.getByTestId("property-doubled")).toContainText(/4\D000/);
  await expect(french.getByRole("button", { name: "Enregistrer Montant" })).toBeVisible();
  const scanFr = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scanFr.violations, JSON.stringify(scanFr.violations, null, 1)).toEqual([]);
});

test("a volunteer sees the properties they may see and nothing hidden [switches on]", async ({ page }) => {
  const grant = createGrant();

  await signIn(page, "volunteer");
  await page.goto(`/objects/${grant.objectId}`);
  await expect(page.getByRole("heading", { level: 1, name: grant.title })).toBeVisible();
  const properties = page.getByRole("region", { name: "Properties" });
  await expect(properties.getByText("Amount")).toBeVisible();
  await expect(properties.getByTestId("property-amount")).toContainText("1,250");
  await expect(properties.getByTestId("property-doubled")).toContainText("2,500");

  // The owner-only property is neither named nor valued anywhere on the page.
  await expect(page.getByText("Board notes")).toHaveCount(0);
  await expect(page.getByText(/Board only /)).toHaveCount(0);
  expect(await page.content()).not.toContain("board_notes");

  // A viewer may look but not change: no fields, no Save, and it says so.
  await expect(properties.getByText("You can see these properties but not change them.")).toBeVisible();
  await expect(properties.getByRole("button", { name: /^Save / })).toHaveCount(0);
  await expect(properties.getByRole("textbox")).toHaveCount(0);

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 1)).toEqual([]);
});

test("the record page is not found while the switch is off [switch off]", async ({ page }) => {
  const grant = createGrant();
  sql("update public.feature_flag set enabled = false where key = 'wos_objects' and organization_id is null;");
  try {
    await signIn(page, "owner");
    await page.goto(`/objects/${grant.objectId}`);
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
    await expect(page.getByText(grant.title)).toHaveCount(0);
  } finally {
    sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
  }
});
