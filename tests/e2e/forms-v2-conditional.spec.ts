import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Forms v2, part 2 (U11): a question that depends on an earlier answer is
 * hidden in the browser and ignored by the server, an answer to a custom
 * type creates a record the responses screen links to, a file answer is
 * stored as a library document with its scan state, and the builder's
 * preview sends nothing. The rules themselves are proved in
 * supabase/tests/forms-v2-conditional.sql; this settles what only a browser
 * can. The screens live behind wos_forms_v2 (and the record page behind
 * wos_objects), which these tests turn on.
 */

// A 1x1 PNG: enough for Storage to accept the upload as an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==",
  "base64",
);

const setSwitches = (on: boolean) =>
  sql(`update feature_flag set enabled = ${on} where key in ('wos_forms_v2', 'wos_objects') and organization_id is null`);

/** Starts a custom-type form in the builder; the caller adds questions and saves. */
async function startCustomForm(page: Page, title: string, typeKey: string) {
  await page.goto("/forms-v2/new");
  await expect(page.getByRole("heading", { name: "New form", level: 1 })).toBeVisible();
  await page.getByLabel("Title (English)").fill(title);
  await page.getByLabel("Title (French)").fill(`${title} (fr)`);
  await page.getByLabel("A record of another type").check();
  await page.getByLabel("Type key").fill(typeKey);
  const first = page.locator("ol > li").first();
  await first.getByLabel("Question (English)").fill("Your name");
  await first.getByLabel("Question (French)").fill("Votre nom");
}

async function addQuestion(page: Page, index: number, en: string, fr: string, kind: string) {
  await page.getByRole("button", { name: "Add a question" }).click();
  const item = page.locator("ol > li").nth(index);
  await item.getByLabel("Question (English)").fill(en);
  await item.getByLabel("Question (French)").fill(fr);
  await item.getByLabel("Answer type").selectOption({ label: kind });
  return item;
}

async function saveAndOpen(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Open the form" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The form is open." })).toBeVisible();
  return page.url();
}

function cleanUp(title: string, typeKey: string) {
  sql(`delete from form_v2 where title_en = '${title}'`);
  sql(`delete from object where type_id in (select id from object_type where key = '${typeKey}')`);
  sql(`delete from object_type where key = '${typeKey}'`);
}

test("a hidden field is skipped and the created record is linked [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const title = `Volunteer offer ${stamp}`;
  const typeKey = `offer_${stamp}`;
  const name = `Sam Driver ${stamp}`;

  setSwitches(true);
  try {
    await signIn(page, "owner");
    await startCustomForm(page, title, typeKey);
    await addQuestion(page, 1, "Can you drive?", "Pouvez-vous conduire?", "Checkbox");
    const licence = await addQuestion(page, 2, "Licence number", "Numéro de permis", "Text");
    await licence.getByLabel("Required").check();
    // The condition is set with pickers: which question, how, and which answer.
    await licence.getByLabel("Ask only when").selectOption({ label: "Can you drive?" });
    await expect(licence.getByLabel("Condition")).toHaveValue("eq");
    await expect(licence.getByLabel("Value")).toHaveValue("true");
    const formUrl = await saveAndOpen(page, title);

    await signOut(page);
    await signIn(page, "volunteer");
    await page.goto(formUrl);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Licence number")).toHaveCount(0);
    await page.getByLabel("Can you drive?").check();
    await expect(page.getByLabel("Licence number")).toBeVisible();
    await page.getByLabel("Licence number").fill("STALE-123");
    // Unticking hides the licence again; the typed value must not be sent.
    await page.getByLabel("Can you drive?").uncheck();
    await expect(page.getByLabel("Licence number")).toHaveCount(0);
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Your answer is now a record.")).toBeVisible({ timeout: 20_000 });
    const recordLink = page.getByRole("link", { name: "Open the record" });
    const recordHref = await recordLink.getAttribute("href");
    expect(recordHref).toMatch(/^\/objects\/[0-9a-f-]{36}$/);
    const objectId = recordHref!.slice("/objects/".length);

    const stored = sql(
      `select (r.answers ? 'licence')::text || '|' || r.created_object_type || '|' || (r.created_object_id = o.id)::text
         || '|' || o.title || '|' || t.key
       from form_v2_response r
       join object o on o.id = '${objectId}'
       join object_type t on t.id = o.type_id
       where r.created_object_id = o.id`,
    );
    expect(stored).toBe(`false|${typeKey}|true|${name}|${typeKey}`);
    const values = sql(
      `select string_agg(d.key || '=' || coalesce(v.value_text, v.value_bool::text), ',' order by d.key)
       from property_value v join property_definition d on d.id = v.property_id
       where v.object_id = '${objectId}'`,
    );
    expect(values).toBe(`can_drive=false,your_name=${name}`);

    // The record page opens for the person who made it.
    await recordLink.click();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 20_000 });

    // The responses screen links the record too.
    await signOut(page);
    await signIn(page, "owner");
    await page.goto(`${formUrl}/responses`);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByRole("link", { name: `Record: ${typeKey}` })).toHaveAttribute("href", `/objects/${objectId}`);
  } finally {
    setSwitches(false);
    cleanUp(title, typeKey);
  }
});

test("a file answer is stored and shows its scan state [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const title = `Proof upload ${stamp}`;
  const typeKey = `proof_${stamp}`;
  const fileName = `licence-${stamp}.png`;

  setSwitches(true);
  try {
    await signIn(page, "owner");
    await startCustomForm(page, title, typeKey);
    await addQuestion(page, 1, "Proof", "Preuve", "File");
    const formUrl = await saveAndOpen(page, title);

    await signOut(page);
    await signIn(page, "volunteer");
    await page.goto(formUrl);
    await page.getByLabel("Your name").fill(`Alex ${stamp}`);
    await page.getByLabel("Proof").setInputFiles({ name: fileName, mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("status").filter({ hasText: `${fileName} uploaded` })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("status").filter({ hasText: "Virus scan pending" })).toBeVisible();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Your answer is now a record.")).toBeVisible({ timeout: 20_000 });

    const stored = sql(
      `select d.kind || '|' || d.scan_status || '|' || (d.created_by = p.id)::text || '|' || (v.value_uuids = array[d.id])::text
       from form_v2_response r
       join document d on d.id = (r.answers->>'proof')::uuid
       join user_profile p on p.email = 'qa-volunteer@example.com'
       join property_value v on v.object_id = r.created_object_id
       join property_definition pd on pd.id = v.property_id and pd.key = 'proof'
       where d.title = '${fileName}'`,
    );
    expect(stored).toBe("file|pending|true|true");

    await signOut(page);
    await signIn(page, "owner");
    await page.goto(`${formUrl}/responses`);
    await expect(page.getByRole("cell", { name: `${fileName} · Virus scan pending` })).toBeVisible();
  } finally {
    setSwitches(false);
    cleanUp(title, typeKey);
    sql(`delete from document where title = '${fileName}'`);
    sql(`delete from storage.objects where bucket_id = 'documents' and name like 'forms-v2/%${fileName}'`);
  }
});

test("the preview never creates a response [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const title = `Preview only ${stamp}`;
  const typeKey = `preview_${stamp}`;

  setSwitches(true);
  try {
    const before = sql(`select count(*) from form_v2_response`);
    await signIn(page, "owner");
    await startCustomForm(page, title, typeKey);
    await addQuestion(page, 1, "Can you drive?", "Pouvez-vous conduire?", "Checkbox");
    const licence = await addQuestion(page, 2, "Licence number", "Numéro de permis", "Text");
    await licence.getByLabel("Ask only when").selectOption({ label: "Can you drive?" });

    await page.getByRole("button", { name: "Preview" }).click();
    const preview = page.getByRole("form", { name: "Preview" });
    await expect(preview.getByText("Nothing is sent.", { exact: false })).toBeVisible();
    await expect(preview.getByLabel("Licence number")).toHaveCount(0);
    await preview.getByLabel("Can you drive?").check();
    await expect(preview.getByLabel("Licence number")).toBeVisible();
    await preview.getByLabel("Your name").fill("Preview person");
    await preview.getByRole("button", { name: "Send" }).click();
    await expect(preview.getByRole("status").filter({ hasText: "Preview only: nothing was sent." })).toBeVisible();

    expect(sql(`select count(*) from form_v2_response`)).toBe(before);
    expect(sql(`select count(*) from form_v2 where title_en = '${title}'`)).toBe("0");
    expect(sql(`select count(*) from object_type where key = '${typeKey}'`)).toBe("0");

    // Back to editing: nothing typed was lost.
    await page.getByRole("button", { name: "Back to editing" }).click();
    await expect(page.getByLabel("Title (English)")).toHaveValue(title);
    await expect(page.locator("ol > li").nth(2).getByLabel("Question (English)")).toHaveValue("Licence number");
  } finally {
    setSwitches(false);
    cleanUp(title, typeKey);
  }
});
