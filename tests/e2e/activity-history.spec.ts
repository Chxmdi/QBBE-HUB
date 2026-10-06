import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 C2: activity history, behind the `wos_pages` and `wos_objects`
 * switches (`wos_editor` too for the page body). A page's Activity tab and a
 * record page's Activity section list who did what and when, newest first,
 * in the reader's language; a restore adds an entry and keeps everything
 * before it; permission changes appear; nobody sees activity about something
 * they cannot open. Entries are written by database triggers
 * (20261110030000_activity_history.sql).
 */

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const KEYS = ["wos_pages", "wos_editor", "wos_objects"] as const;

let saved = "";
const setSwitches = (values: Record<(typeof KEYS)[number], boolean>) =>
  sql(
    KEYS.map(
      (key) => `update public.feature_flag set enabled = ${values[key]} where key = '${key}' and organization_id is null;`,
    ).join("\n"),
  );

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  saved = sql(
    `select string_agg(key || '=' || enabled, ',') from public.feature_flag where key in ('wos_pages', 'wos_editor', 'wos_objects') and organization_id is null`,
  );
  setSwitches({ wos_pages: true, wos_editor: true, wos_objects: true });
});
test.afterAll(() => {
  for (const pair of saved.split(",").filter(Boolean)) {
    const [key, value] = pair.split("=");
    sql(`update public.feature_flag set enabled = ${value === "true"} where key = '${key}' and organization_id is null;`);
  }
});

/** Runs statements as a signed-in person, so triggers label them with that person. */
const as = (userId: string, statement: string) =>
  sql(`begin;
    select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    ${statement}
    commit;`)
    .split("\n")
    .filter((line) => line && line !== "BEGIN" && line !== "COMMIT")
    .pop() ?? "";

const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text }],
  children: [],
});

/** A workspace page the staff member wrote, with a saved body. */
function seedPage(title: string, blocks: ReturnType<typeof paragraph>[]): string {
  const content = JSON.stringify({ version: 1, blocks }).replace(/'/g, "''");
  return as(
    STAFF,
    `with org as (select organization_id from public.organization_membership where user_id = '${STAFF}'),
    p as (
      insert into public.page (organization_id, visibility, created_by, title)
      select organization_id, 'workspace', '${STAFF}', '${title}' from org returning id, organization_id
    ),
    d as (
      insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
      select id, 'page', organization_id, '${content}'::jsonb, 'x', '${STAFF}' from p returning object_id
    )
    select object_id from d;`,
  );
}

/** A custom record the owner made, a second one only owners and admins open, and a "Room" property. */
function seedRecords(suffix: string) {
  const typeKey = `c2_venue_${suffix}`;
  sql(`
    with org as (select organization_id from public.organization_membership where user_id = '${OWNER}' limit 1),
    typ as (
      insert into public.object_type (organization_id, key, name_en, name_fr, kind)
      select organization_id, '${typeKey}', 'Venue', 'Lieu', 'custom' from org returning id, organization_id
    )
    insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, position)
    select organization_id, id, 'room', 'Room', 'Salle', 'text', 1 from typ;
  `);
  const create = (title: string) =>
    as(
      OWNER,
      `insert into public.object (organization_id, type_id, title, owner_id, created_by)
       select t.organization_id, t.id, '${title}', '${OWNER}', '${OWNER}' from public.object_type t where t.key = '${typeKey}'
       returning id;`,
    );
  return { recordId: create(`Main hall ${suffix}`), hiddenId: create(`Board room ${suffix}`), typeKey };
}

const collab = (page: Page) => page.getByRole("region", { name: "Discussion and history" });
const entries = (scope: Page | Locator, name = "Activity, newest first") => scope.getByRole("list", { name }).getByRole("listitem");

async function openPage(page: Page, pageId: string, editorName = "Document content") {
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("textbox", { name: editorName })).toBeVisible({ timeout: 30_000 });
}

/** Puts the caret at the end of a one-line block. */
async function caretAtEnd(page: Page, blockId: string) {
  const block = page.locator(`.qbbe-editor [data-id="${blockId}"] [data-content-type]`).first();
  const box = await block.boundingBox();
  if (!box) throw new Error(`block ${blockId} not visible`);
  await block.click({ position: { x: box.width - 4, y: box.height / 2 } });
}

async function seriousAxe(page: Page, within: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).include(within).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)}`));
}

const documentText = (pageId: string) =>
  sql(`select content_text from public.editor_document where object_id = '${pageId}'`);

test("a page's Activity tab lists block changes newest first and keeps its history across a restore [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 8);
  const pageId = seedPage(`Activity ${suffix}`, [
    paragraph("first", "First block."),
    paragraph("second", "Second block."),
    paragraph("third", "Third block."),
  ]);

  await signIn(page, "staff");
  await openPage(page, pageId);
  await collab(page).getByRole("tab", { name: "Versions" }).click();
  await collab(page).getByLabel("Version name (optional)").fill("Original");
  await collab(page).getByRole("button", { name: "Save version" }).click();
  await expect(collab(page).getByText("Version saved.")).toBeVisible();

  // Edit one block, then move the third block to the top from the keyboard.
  await caretAtEnd(page, "first");
  await page.keyboard.type(" Edited.");
  await expect.poll(() => documentText(pageId), { timeout: 30_000 }).toContain("Edited.");
  await caretAtEnd(page, "third");
  await page.keyboard.press("Control+Shift+ArrowUp");
  await page.keyboard.press("Control+Shift+ArrowUp");
  await expect
    .poll(() => sql(`select content -> 'blocks' -> 0 ->> 'id' from public.editor_document where object_id = '${pageId}'`), {
      timeout: 30_000,
    })
    .toBe("third");

  await page.reload();
  await collab(page).getByRole("tab", { name: "Activity" }).click();
  const list = entries(collab(page));
  await expect(list.first()).toContainText("QA Staff moved a block (paragraph): “Third block.”");
  await expect(collab(page).getByText("QA Staff edited a block (paragraph): “First block. Edited.”")).toBeVisible();
  await expect(collab(page).getByText("QA Staff saved the version “Original”")).toBeVisible();
  await expect(list.last()).toContainText("QA Staff created the page");
  // Newest first, each with a machine-readable time.
  const times = await list.locator("time").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime") ?? ""));
  expect(times.length).toBeGreaterThanOrEqual(4);
  expect([...times].sort().reverse()).toEqual(times);
  const before = await list.count();

  // Restore the named version from the compare screen.
  await collab(page).getByRole("tab", { name: "Versions" }).click();
  await page.getByRole("link", { name: /^Compare with current \(Original,/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare versions" })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByText("Restored. The previous state was saved as a version.")).toBeVisible();

  await openPage(page, pageId);
  await collab(page).getByRole("tab", { name: "Activity" }).click();
  await expect(collab(page).getByText(/^QA Staff restored an earlier version/)).toBeVisible();
  // The restore's own block changes follow it, and nothing from before is lost.
  await expect(collab(page).getByText("QA Staff edited a block (paragraph): “First block.”")).toBeVisible();
  await expect(collab(page).getByText("QA Staff edited a block (paragraph): “First block. Edited.”")).toBeVisible();
  expect(await entries(collab(page)).count()).toBeGreaterThan(before);
  await expect(entries(collab(page)).last()).toContainText("QA Staff created the page");
  // The moves from before the restore are still listed, beside the restore's own.
  expect(await collab(page).getByText("QA Staff moved a block (paragraph): “Third block.”").count()).toBeGreaterThanOrEqual(2);

  expect(await seriousAxe(page, "#page-collab"), "axe on the Activity tab").toEqual([]);
});

test("activity reads in French, is reached by keyboard and passes axe in both themes [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 8);
  const pageId = seedPage(`Activité ${suffix}`, [paragraph("only", "Bonjour.")]);
  as(STAFF, `update public.page set title = 'Guide ${suffix}' where id = '${pageId}';`);

  await signIn(page, "staff");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await openPage(page, pageId, "Contenu du document");
  const region = page.getByRole("region", { name: "Discussion et historique" });

  // From the Comments tab, the arrow keys reach Activity.
  await region.getByRole("tab", { name: "Commentaires" }).focus();
  await page.keyboard.press("End");
  const tab = region.getByRole("tab", { name: "Activité" });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Tab");
  await expect(region.getByRole("tabpanel", { name: "Activité" })).toBeFocused();

  const list = entries(region, "Activité, de la plus récente à la plus ancienne");
  await expect(list.first()).toContainText(`QA Staff a renommé la page « Guide ${suffix} »`);
  await expect(list.last()).toContainText("QA Staff a créé la page");
  // The time is written the French way (a French month abbreviation, 24-hour clock).
  await expect(list.first().locator("time")).toHaveText(/^\d{1,2} \p{L}+\.? \d{4}.*\d{1,2} h \d{2}$/u);

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    expect(await seriousAxe(page, "#page-collab"), `${theme}: Activity tab in French`).toEqual([]);
  }
  await page.evaluate(() => {
    localStorage.setItem("qbbe-theme", "light");
    document.documentElement.classList.remove("dark");
  });
  await page.context().clearCookies({ name: "qbbe-locale" });
});

test("permission changes appear, and nobody sees activity about what they cannot open [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 8);
  const { recordId, hiddenId } = seedRecords(suffix);

  // On the record: a property, a relation to a record the volunteer cannot
  // open, and the volunteer given a role.
  as(
    OWNER,
    `insert into public.property_value (object_id, property_id, organization_id, value_text)
     select o.id, p.id, o.organization_id, 'Room 2' from public.object o
     join public.property_definition p on p.type_id = o.type_id and p.key = 'room' where o.id = '${recordId}';
     insert into public.object_relation (organization_id, from_id, to_id, relation_type_id)
     select o.organization_id, '${recordId}', '${hiddenId}', r.id from public.object o
     join public.relation_type r on r.organization_id = o.organization_id and r.key = 'related_to' where o.id = '${recordId}';
     insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id)
     select o.organization_id, o.id, 'person', '${VOLUNTEER}',
            (select id from public.access_role where key = 'viewer' and organization_id is null)
     from public.object o where o.id = '${recordId}';`,
  );

  await signIn(page, "owner");
  await page.goto(`/objects/${recordId}`);
  const section = page.getByTestId("record-section-activity");
  await expect(section.getByRole("heading", { name: "Activity" })).toBeVisible({ timeout: 30_000 });
  const list = entries(section);
  await expect(list.first()).toContainText("QA Owner gave QA Volunteer the role");
  await expect(section.getByText(`QA Owner linked “Board room ${suffix}” (`)).toBeVisible();
  await expect(section.getByText("QA Owner set Room to Room 2")).toBeVisible();
  await expect(list.last()).toContainText("QA Owner created this record");

  // A page made private: a permission change on the page.
  const pageId = seedPage(`Private soon ${suffix}`, [paragraph("one", "Notes.")]);
  as(STAFF, `update public.page set visibility = 'private' where id = '${pageId}';`);

  await signIn(page, "volunteer");
  // The record they were given: its activity, but not the relation to the record they cannot open.
  await page.goto(`/objects/${recordId}`);
  const theirs = page.getByTestId("record-section-activity");
  await expect(entries(theirs).first()).toContainText("QA Owner gave QA Volunteer the role");
  await expect(theirs.getByText("QA Owner set Room to Room 2")).toBeVisible();
  await expect(theirs.getByText(/linked/)).toHaveCount(0);
  await expect(theirs.getByText(`Board room ${suffix}`)).toHaveCount(0);
  // The record they cannot open, and the staff member's private page: nothing at all.
  await page.goto(`/objects/${hiddenId}`);
  await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  await expect(page.getByTestId("record-section-activity")).toHaveCount(0);
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("tab", { name: "Activity" })).toHaveCount(0);
  await expect(page.getByText("made the page private")).toHaveCount(0);

  // The author sees the permission change on the page.
  await signIn(page, "staff");
  await openPage(page, pageId);
  await collab(page).getByRole("tab", { name: "Activity" }).click();
  await expect(entries(collab(page)).first()).toContainText("QA Staff made the page private");
});

test("activity shows empty, error with retry, older pages, and fits 320 px [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 8);
  const { recordId } = seedRecords(suffix);

  await signIn(page, "owner");

  // Empty.
  sql(`delete from public.activity_entry where object_id = '${recordId}'`);
  await page.goto(`/objects/${recordId}`);
  const section = page.getByTestId("record-section-activity");
  await expect(section.getByText("No activity yet. Changes to this record will be listed here.")).toBeVisible({ timeout: 30_000 });

  // Error, then "Try again" once the read works again.
  sql(`
    insert into public.activity_entry (organization_id, object_id, object_type, event, actor_kind, actor_id, details, occurred_at)
    select o.organization_id, o.id, 'c2_venue_${suffix}', 'property.updated', 'person', '${OWNER}',
           jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('property', 'room', 'before', null, 'after', 'Room ' || g))),
           now() - make_interval(mins => g)
    from public.object o, generate_series(1, 35) g where o.id = '${recordId}';
  `);
  sql("revoke select on public.activity_entry from authenticated;");
  try {
    await page.reload();
    await expect(section.getByRole("alert")).toContainText("Activity could not be loaded.", { timeout: 30_000 });
  } finally {
    sql("grant select on public.activity_entry to authenticated;");
  }
  await section.getByRole("button", { name: "Try again" }).click();
  const list = entries(section);
  await expect(list).toHaveCount(30);
  await expect(list.first()).toContainText("QA Owner set Room to Room 1");

  // Older entries, from the keyboard.
  const older = section.getByRole("button", { name: "Show older activity" });
  await older.focus();
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(35);
  await expect(list.last()).toContainText("QA Owner set Room to Room 35");
  await expect(section.getByText("That is the start of the history.")).toBeVisible();

  // 320 px wide: no sideways scroll.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(entries(page.getByTestId("record-section-activity")).first()).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    expect(await seriousAxe(page, "[data-testid='record-section-activity']"), `${theme}: record activity`).toEqual([]);
  }
  await page.evaluate(() => {
    localStorage.setItem("qbbe-theme", "light");
    document.documentElement.classList.remove("dark");
  });
});

test("no Activity tab or section while a switch is off [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const pageId = seedPage(`Switch ${suffix}`, [paragraph("one", "Text.")]);
  const { recordId } = seedRecords(suffix);
  try {
    // wos_objects off: the page keeps Comments and Versions, without Activity.
    setSwitches({ wos_pages: true, wos_editor: true, wos_objects: false });
    await signIn(page, "owner");
    await openPage(page, pageId);
    await expect(collab(page).getByRole("tab", { name: "Versions" })).toBeVisible();
    await expect(collab(page).getByRole("tab", { name: "Activity" })).toHaveCount(0);

    // wos_pages off: the record page has no Activity section.
    setSwitches({ wos_pages: false, wos_editor: true, wos_objects: true });
    await page.goto(`/objects/${recordId}`);
    await expect(page.getByRole("heading", { level: 1, name: `Main hall ${suffix}` })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("record-section-activity")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Activity" })).toHaveCount(0);
  } finally {
    setSwitches({ wos_pages: true, wos_editor: true, wos_objects: true });
  }
});
