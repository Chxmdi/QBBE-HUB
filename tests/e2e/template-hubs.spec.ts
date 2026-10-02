import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Templates that build hubs, with versions (Workspace OS wave 2, unit T1),
 * behind the `wos_pages` switch (templates themselves appear with
 * `wos_objects`). Each test writes its own templates and pages through
 * sql() and removes them afterwards; the seed is never changed.
 *
 *   T1-1  a template holds view, task and decision blocks and checklists;
 *   T1-2  "Use template" with a start date makes the page, a project, its
 *         milestones and tasks with real dates, and a task view of them;
 *   T1-3  the preview is the real editor, read-only;
 *   T1-4  editing makes a new version; an older page keeps its content and
 *         says which version it came from;
 *   T1-5  a duplicate carries no private page;
 *   T1-6  someone who cannot see a template cannot preview, use or copy it.
 */

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

const switches = (on: boolean) =>
  sql(
    `update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor', 'wos_objects', 'wos_lenses') and organization_id is null;`,
  );

const orgId = () => sql(`select organization_id from public.organization_membership where user_id = '${OWNER}' limit 1`);
const q = (value: string) => value.replace(/'/g, "''");

/** A published page template written straight into the database, as `author`. */
function insertTemplate(name: string, body: object, author = OWNER, status = "published"): string {
  return sql(
    `insert into public.template_v2 (organization_id, scope, name_en, name_fr, status, created_by, body)
     values ('${orgId()}', 'page', '${q(name)}', '${q(name)} (fr)', '${status}', '${author}', '${q(JSON.stringify(body))}'::jsonb)
     returning id`,
  );
}

const text = (value: string) => [{ type: "text", text: value, styles: {} }];

/** Removes pages (and what a hub made for them), then the templates. */
function cleanUp(templateIds: string[], extraPageIds: string[] = []) {
  const pages = sql(
    `select coalesce(string_agg(page_id::text, ','), '') from public.page_template_origin where template_id = any(array[${templateIds
      .map((id) => `'${id}'`)
      .join(",") || "null"}]::uuid[])`,
  )
    .split(",")
    .filter(Boolean)
    .concat(extraPageIds);
  for (const id of pages) {
    const project = sql(`select coalesce(project_id::text, '') from public.page_template_origin where page_id = '${id}'`);
    sql(`delete from public.editor_document where object_id = '${id}'; delete from public.page where id = '${id}';`);
    if (project) sql(`delete from public.task where project_id = '${project}'; delete from public.project where id = '${project}';`);
  }
  for (const id of templateIds) sql(`delete from public.template_v2 where id = '${id}'`);
}

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("qbbe-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
}

function hubBody(stamp: number) {
  return {
    title: { en: `Event hub ${stamp}`, fr: `Carrefour ${stamp}` },
    blocks: [],
    variables: ["owner"],
    document: {
      en: [
        { id: "h1", type: "heading", props: { level: 2 }, content: text("Run by {{owner}}"), children: [] },
        { id: "c1", type: "checkListItem", props: { checked: false }, content: text("Book the room by {{start+7}}"), children: [] },
        {
          id: "v1",
          type: "query",
          props: { preset: "my_open", spec: JSON.stringify({ version: 2, source: { type: "task" }, layout: "list", title: "Open work", where: [{ path: "title", op: "contains", value: `no-match-${stamp}` }] }) },
          children: [],
        },
        { id: "t1", type: "task", props: { objectId: "" }, children: [] },
        { id: "d1", type: "decision", props: { objectId: "" }, children: [] },
      ],
      fr: [
        { id: "h1", type: "heading", props: { level: 2 }, content: text("Animé par {{owner}}"), children: [] },
        { id: "c1", type: "checkListItem", props: { checked: false }, content: text("Réserver la salle d’ici le {{start+7}}"), children: [] },
      ],
    },
    hub: {
      milestones: [
        { title: { en: "Venue booked", fr: "Salle réservée" }, offsets: { due: 14 } },
        { title: { en: "Event day", fr: "Jour J" }, offsets: { due: 42 } },
      ],
      tasks: [
        { title: { en: `Book the venue ${stamp}`, fr: `Réserver la salle ${stamp}` }, priority: "high", offsets: { due: 10 }, milestone: 0 },
        { title: { en: `Send invitations ${stamp}`, fr: `Envoyer les invitations ${stamp}` }, offsets: { start: 14, due: 21 }, milestone: 1 },
      ],
    },
  };
}

test.describe.configure({ mode: "serial" });

test.describe("with the switches on", () => {
  test.beforeAll(() => switches(true));
  test.afterAll(() => switches(false));

  test("a hub template previews in the real editor and builds the page, project, milestones, tasks and their view [switches on]", async ({ page }) => {
    test.setTimeout(240_000);
    const stamp = Date.now();
    const name = `Event hub ${stamp}`;
    const pageTitle = `Gala ${stamp}`;
    const templateId = insertTemplate(name, hubBody(stamp));
    try {
      await signIn(page, "owner");
      await page.goto(`/templates-v2/${templateId}`);
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

      // T1-3: the preview is the real editor, read-only, with the template's blocks.
      const preview = page.getByRole("region", { name: "What this creates" });
      const editor = preview.getByRole("textbox", { name: "Preview of the page" });
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await expect(editor).toHaveAttribute("contenteditable", "false");
      // T1-1: the template's view block, task block, decision block and checklist render as editor blocks.
      for (const type of ["heading", "checkListItem", "query", "task", "decision"]) {
        await expect(editor.locator(`[data-content-type='${type}']`)).toHaveCount(1);
      }
      await page.getByLabel("Start date").fill("2031-05-01");
      await page.getByRole("textbox", { name: "Owner", exact: true }).fill("Jane Doe");
      await expect(editor.locator("h2", { hasText: "Run by Jane Doe" })).toBeVisible({ timeout: 30_000 });
      await expect(editor.locator("[data-content-type='checkListItem']", { hasText: "Book the room by 2031-05-08" })).toBeVisible();
      // Nothing can be typed into the preview.
      await editor.locator("h2").click();
      await page.keyboard.type("typed");
      await expect(editor.locator("h2")).toHaveText("Run by Jane Doe");

      // T1-2: the plan shows the hub with resolved dates before anything is made.
      const plan = preview.getByTestId("hub-plan");
      await expect(plan.getByText("Venue booked")).toBeVisible();
      await expect(plan.locator("li", { hasText: "Venue booked" })).toContainText("May 15, 2031");
      await expect(plan.locator("li", { hasText: `Send invitations ${stamp}` })).toContainText("Starts May 15, 2031 · Due May 22, 2031");

      await expect(page.getByLabel("Program for the hub's project")).toHaveValue("none");
      await page.getByLabel("Where").selectOption({ label: "Workspace (top level)" });
      await page.getByLabel("Page title").fill(pageTitle);
      await page.getByRole("button", { name: "Use template" }).click();
      await page.waitForURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const pageId = page.url().split("/").pop()!;

      // The page: the rendered document, its task view listing the hub's tasks, and where it came from.
      const body = page.getByRole("textbox", { name: "Document content" });
      await expect(body).toBeVisible({ timeout: 30_000 });
      await expect(body.locator("[data-content-type='checkListItem']", { hasText: "Book the room by 2031-05-08" })).toBeVisible();
      // The hub's task view lists exactly its two tasks, as links.
      const hubView = body.locator("[data-content-type='query']").filter({ hasText: "Tasks" });
      await expect(hubView.getByRole("link", { name: `Book the venue ${stamp}` })).toBeVisible({ timeout: 30_000 });
      await expect(hubView.getByRole("link", { name: `Send invitations ${stamp}` })).toBeVisible();
      await expect(hubView.getByRole("link", { name: new RegExp(`${stamp}`) })).toHaveCount(2);
      await expect(page.getByTestId("template-origin")).toContainText(`Made from the template “${name}”, version 1.`);
      await expect(page.getByTestId("template-origin").getByRole("link", { name: "Open the hub's project" })).toBeVisible();

      const projectId = sql(`select project_id from public.page_template_origin where page_id = '${pageId}'`);
      expect(sql(`select name || '|' || start_date || '|' || target_date from public.project where id = '${projectId}'`)).toBe(
        `${pageTitle}|2031-05-01|2031-06-12`,
      );
      expect(sql(`select string_agg(name || ':' || due_date, ',' order by due_date) from public.milestone where project_id = '${projectId}'`)).toBe(
        "Venue booked:2031-05-15,Event day:2031-06-12",
      );
      expect(
        sql(
          `select string_agg(t.title || ':' || t.due_at::date || ':' || m.name, ',' order by t.due_at) from public.task t join public.milestone m on m.id = t.milestone_id where t.project_id = '${projectId}'`,
        ),
      ).toBe(`Book the venue ${stamp}:2031-05-11:Venue booked,Send invitations ${stamp}:2031-05-22:Event day`);
    } finally {
      cleanUp([templateId]);
    }
  });

  test("editing a template makes a new version and older pages keep theirs [switches on]", async ({ page }) => {
    test.setTimeout(240_000);
    const stamp = Date.now();
    const name = `Weekly notes ${stamp}`;
    const templateId = insertTemplate(name, {
      title: { en: name, fr: name },
      blocks: [],
      document: {
        en: [{ id: "p1", type: "paragraph", content: text(`First words ${stamp}`), children: [] }],
        fr: [{ id: "p1", type: "paragraph", content: text(`Premiers mots ${stamp}`), children: [] }],
      },
    });
    try {
      await signIn(page, "owner");
      await page.goto(`/templates-v2/${templateId}`);
      const manage = page.getByTestId("template-manage");
      await expect(manage.getByText("Version 1", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      // Empty: no page made from it yet.
      await expect(manage.getByText("No pages made from it yet")).toBeVisible();

      // A page from version 1.
      await page.getByLabel("Page title").fill(`Old ${stamp}`);
      await page.getByRole("button", { name: "Use template" }).click();
      await page.waitForURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const oldPage = page.url().split("/").pop()!;

      // Edit in the real editor and save: version 2.
      await page.goto(`/templates-v2/${templateId}`);
      await manage.getByRole("button", { name: "Edit template" }).click();
      const editorPanel = page.getByTestId("template-editor");
      const english = editorPanel.getByRole("textbox", { name: "Page content (English)" });
      await expect(english).toBeVisible({ timeout: 30_000 });
      await english.getByText(`First words ${stamp}`).click();
      await page.keyboard.press("End");
      await page.keyboard.type(" and second words");
      await expect(english).toContainText(`First words ${stamp} and second words`);
      await editorPanel.getByRole("button", { name: "Save as a new version" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved as version 2." })).toBeVisible({ timeout: 30_000 });
      await expect(manage.getByText("Version 2", { exact: true }).first()).toBeVisible();
      await expect(manage.locator("li", { hasText: "Version 1" })).toContainText("1 pages made from it");
      expect(sql(`select version from public.template_v2 where id = '${templateId}'`)).toBe("2");

      // A page from version 2 says the new words, and that it came from version 2.
      await page.getByLabel("Page title").fill(`New ${stamp}`);
      await page.getByRole("button", { name: "Use template" }).click();
      await page.waitForURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(`First words ${stamp} and second words`, { timeout: 30_000 });
      await expect(page.getByTestId("template-origin")).toContainText(`Made from the template “${name}”, version 2.`);

      // The version 1 page kept its content and still says version 1.
      await page.goto(`/pages/${oldPage}`);
      const oldBody = page.getByRole("textbox", { name: "Document content" });
      await expect(oldBody).toContainText(`First words ${stamp}`, { timeout: 30_000 });
      await expect(oldBody).not.toContainText("second words");
      await expect(page.getByTestId("template-origin")).toContainText(`Made from the template “${name}”, version 1.`);
    } finally {
      cleanUp([templateId]);
    }
  });

  test("duplicating a template leaves out private pages [switches on]", async ({ page }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const name = `Board pack ${stamp}`;
    const org = orgId();
    const privatePage = sql(
      `insert into public.page (organization_id, visibility, created_by, title) values ('${org}', 'private', '${OWNER}', 'Owner secret ${stamp}') returning id`,
    );
    const sharedPage = sql(
      `insert into public.page (organization_id, visibility, created_by, title) values ('${org}', 'workspace', '${OWNER}', 'Team page ${stamp}') returning id`,
    );
    const blocks = [
      { id: "a", type: "pageLink", props: { objectId: privatePage }, children: [] },
      { id: "b", type: "pageLink", props: { objectId: sharedPage }, children: [] },
      {
        id: "c",
        type: "paragraph",
        content: [{ type: "link", href: `/pages/${privatePage}`, content: text(`secret plan ${stamp}`) }],
        children: [],
      },
    ];
    const templateId = insertTemplate(name, { title: { en: name, fr: name }, blocks: [], document: { en: blocks, fr: blocks } });
    let copyId = "";
    try {
      await signIn(page, "staff");
      await page.goto(`/templates-v2/${templateId}`);
      const manage = page.getByTestId("template-manage");
      await expect(manage.getByRole("button", { name: "Duplicate" })).toBeVisible({ timeout: 30_000 });
      // Staff may copy what they did not write, but not edit it.
      await expect(manage.getByRole("button", { name: "Edit template" })).toHaveCount(0);
      await manage.getByRole("button", { name: "Duplicate" }).click();
      await page.waitForURL((url) => /\/templates-v2\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.endsWith(templateId), {
        timeout: 30_000,
      });
      copyId = page.url().split("/").pop()!;
      await expect(page.getByRole("heading", { name: `Copy of ${name}`, level: 1 })).toBeVisible();

      const copied = sql(`select body::text from public.template_v2 where id = '${copyId}'`);
      expect(copied).not.toContain(privatePage);
      expect(copied).toContain(sharedPage);
      expect(sql(`select status || '|' || created_by || '|' || version from public.template_v2 where id = '${copyId}'`)).toBe(
        `draft|${STAFF}|1`,
      );
      // The copy's preview shows the link's words as plain text, linking nowhere private.
      const preview = page.getByRole("textbox", { name: "Preview of the page" });
      await expect(preview.getByText(`secret plan ${stamp}`)).toBeVisible({ timeout: 30_000 });
      await expect(preview.locator(`a[href*="${privatePage}"]`)).toHaveCount(0);
    } finally {
      cleanUp(copyId ? [templateId, copyId] : [templateId], [privatePage, sharedPage]);
    }
  });

  test("someone who cannot see a template cannot preview, use or copy it [switches on]", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const name = `Staff draft ${stamp}`;
    const draftId = insertTemplate(
      name,
      { title: { en: name, fr: name }, blocks: [], document: { en: [{ type: "paragraph", content: text("draft") }], fr: [] } },
      STAFF,
      "draft",
    );
    try {
      await signIn(page, "volunteer");
      await page.goto(`/templates-v2/${draftId}`);
      await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Preview of the page" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Duplicate" })).toHaveCount(0);
      await page.goto("/templates-v2?scope=page");
      await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name })).toHaveCount(0);
    } finally {
      cleanUp([draftId]);
    }
  });

  test("loading and a failed load with a retry, in French, keyboard only, at 320 px and in both themes [switches on]", async ({ page, context }) => {
    test.setTimeout(240_000);
    const stamp = Date.now();
    const name = `Carrefour ${stamp}`;
    const templateId = insertTemplate(name, hubBody(stamp));
    try {
      await signIn(page, "owner");
      // The first request for the template's versions fails, slowly; the retry succeeds.
      let failed = false;
      await page.route(`**/templates-v2/${templateId}`, async (route) => {
        const request = route.request();
        if (!failed && request.method() === "POST" && (request.postData() ?? "").includes(templateId)) {
          failed = true;
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await route.abort();
          return;
        }
        await route.continue();
      });
      sql(`update public.user_profile set locale = 'fr-CA' where id = '${OWNER}'`);
      await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
      await page.goto(`/templates-v2/${templateId}`);
      await expect(page.getByRole("status").filter({ hasText: "Chargement des versions…" })).toBeVisible();
      const alert = page.getByRole("alert").filter({ hasText: "Les versions n’ont pas pu être chargées." });
      await expect(alert).toBeVisible({ timeout: 30_000 });

      // Keyboard only: reach "Try again" with Tab and press Enter.
      // Start from the template's heading, as someone reading down the page would.
      await page.getByRole("heading", { name, level: 1 }).click();
      const retry = alert.getByRole("button", { name: "Réessayer" });
      for (let i = 0; i < 60 && !(await retry.evaluate((el) => el === document.activeElement)); i += 1) {
        await page.keyboard.press("Tab");
      }
      await expect(retry).toBeFocused();
      await page.keyboard.press("Enter");
      const manage = page.getByTestId("template-manage");
      await expect(manage.getByRole("button", { name: "Dupliquer" })).toBeVisible({ timeout: 30_000 });
      await expect(manage.getByRole("button", { name: "Modifier le modèle" })).toBeVisible();
      const preview = page.getByRole("textbox", { name: "Aperçu de la page" });
      await expect(preview).toBeVisible({ timeout: 30_000 });
      await expect(preview.locator("[data-content-type='checkListItem']")).toContainText("Réserver la salle d’ici le");
      await expect(page.getByLabel("Programme du projet du carrefour")).toBeVisible();
      await expect(page.getByTestId("hub-plan").getByText("Jour J")).toBeVisible();

      // Keyboard only: Tab reaches the edit button, Enter opens the editor, which is labelled.
      const edit = manage.getByRole("button", { name: "Modifier le modèle" });
      await page.getByRole("heading", { name, level: 1 }).click();
      for (let i = 0; i < 80 && !(await edit.evaluate((el) => el === document.activeElement)); i += 1) {
        await page.keyboard.press("Tab");
      }
      await expect(edit).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("textbox", { name: "Contenu de la page (anglais)" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Annuler", exact: true }).click();
      await expect(manage.getByRole("button", { name: "Dupliquer" })).toBeVisible();

      for (const theme of ["light", "dark"] as const) {
        await setTheme(page, theme);
        expect(await axeProblems(page), `template screen accessibility (${theme})`).toEqual([]);
      }

      // 320 px: nothing scrolls sideways.
      await page.setViewportSize({ width: 320, height: 640 });
      await page.reload();
      await expect(page.getByRole("textbox", { name: "Aperçu de la page" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("template-manage")).toBeVisible({ timeout: 30_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await setTheme(page, "light").catch(() => undefined);
      sql(`update public.user_profile set locale = null where id = '${OWNER}'`);
      cleanUp([templateId]);
    }
  });
});

test("with wos_pages off a page template shows none of the new tools [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  sql(`update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null`);
  sql(`update public.feature_flag set enabled = false where key = 'wos_pages' and organization_id is null`);
  const stamp = Date.now();
  const name = `Switched off ${stamp}`;
  const templateId = insertTemplate(name, hubBody(stamp));
  try {
    await signIn(page, "owner");
    await page.goto(`/templates-v2/${templateId}`);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.getByText("Pages are not turned on yet, so this template can only be previewed.")).toBeVisible();
    await expect(page.getByTestId("template-manage")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Duplicate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit template" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Preview of the page" })).toHaveCount(0);
    await expect(page.getByTestId("hub-plan")).toHaveCount(0);
  } finally {
    cleanUp([templateId]);
    sql(`update public.feature_flag set enabled = false where key = 'wos_objects' and organization_id is null`);
  }
});
