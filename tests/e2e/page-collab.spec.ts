import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS U9: comments and versions on a page, behind the `wos_pages`
 * and `wos_editor` switches. A page keeps an automatic and a named version,
 * two versions are compared and one restored; a block comment stays on its
 * block after the block moves; a volunteer cannot reach a workspace page's
 * comments.
 */

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

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
  const text = blocks.map((block) => block.content[0].text).join("\n").replace(/'/g, "''");
  return sql(`
    with org as (select organization_id from public.organization_membership where user_id = '${STAFF}'),
    p as (
      insert into public.page (organization_id, visibility, created_by, title)
      select organization_id, 'workspace', '${STAFF}', '${title}' from org returning id, organization_id
    ),
    d as (
      insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
      select id, 'page', organization_id, '${content}'::jsonb, '${text}', '${STAFF}' from p returning object_id
    )
    select object_id from d;
  `);
}

/**
 * Serious accessibility findings, on the whole screen or only inside one
 * part of it. On a page, the scan covers this unit's panel: the pages
 * sidebar has its own spec (wos-pages.spec.ts).
 */
async function seriousAxe(page: Page, within?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const results = await (within ? builder.include(within) : builder).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)}`));
}

/** Puts the caret at the end of a one-line block. */
async function caretAtEnd(page: Page, blockId: string) {
  const block = page.locator(`.qbbe-editor [data-id="${blockId}"] [data-content-type]`).first();
  const box = await block.boundingBox();
  if (!box) throw new Error(`block ${blockId} not visible`);
  await block.click({ position: { x: box.width - 4, y: box.height / 2 } });
}

const documentText = (pageId: string) =>
  sql(`select content_text from public.editor_document where object_id = '${pageId}'`);

test("a page keeps versions, compares two and restores one [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 8);
  const pageId = seedPage(`Gala plan ${suffix}`, [
    paragraph("intro", "Plan the gala dinner."),
    paragraph("budget", "Budget review in May."),
  ]);

  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });

  // A named version of the page as written.
  const collab = page.getByRole("region", { name: "Discussion and history" });
  await collab.getByRole("tab", { name: "Versions" }).click();
  await collab.getByLabel("Version name (optional)").fill("Original");
  await collab.getByRole("button", { name: "Save version" }).click();
  await expect(collab.getByText("Version saved.")).toBeVisible();
  await expect(collab.getByRole("region", { name: "Version history" }).getByText("Original", { exact: true })).toBeVisible();

  // An edit inside ten minutes of the last version saves the page but takes no snapshot.
  await caretAtEnd(page, "intro");
  await page.keyboard.type(" Invite sponsors.");
  await expect.poll(() => documentText(pageId), { timeout: 30_000 }).toContain("Invite sponsors.");
  expect(sql(`select count(*) from public.object_version where object_id = '${pageId}' and kind = 'auto'`)).toBe("0");

  // Ten minutes later, the next save takes an automatic snapshot.
  sql(`update public.object_version set created_at = created_at - interval '11 minutes' where object_id = '${pageId}'`);
  await caretAtEnd(page, "budget");
  await page.keyboard.type(" Book the hall.");
  await expect.poll(() => documentText(pageId), { timeout: 30_000 }).toContain("Book the hall.");
  await expect
    .poll(() => sql(`select count(*) from public.object_version where object_id = '${pageId}' and kind = 'auto'`), { timeout: 30_000 })
    .toBe("1");
  expect(
    sql(`select content -> 'blocks' -> 1 ->> 'text' from public.object_version where object_id = '${pageId}' and kind = 'auto'`),
  ).toBe("Budget review in May. Book the hall.");

  // Compare the two versions side by side.
  const original = sql(`select id from public.object_version where object_id = '${pageId}' and label = 'Original'`);
  const automatic = sql(`select id from public.object_version where object_id = '${pageId}' and kind = 'auto'`);
  await page.reload();
  await page.getByRole("region", { name: "Discussion and history" }).getByRole("tab", { name: "Versions" }).click();
  await page.getByRole("link", { name: /^Compare with current \(Original,/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare versions" })).toBeVisible();
  await page.goto(`/collab/versions/${pageId}/compare?type=page&from=${original}&to=${automatic}`);
  await expect(page.getByText("2 differences")).toBeVisible();
  const content = page.getByRole("table", { name: "Content" });
  await expect(content.locator("ins", { hasText: "Invite sponsors." })).toBeVisible();
  await expect(content.locator("ins", { hasText: "Book the hall." })).toBeVisible();
  expect(await seriousAxe(page), "axe on the page compare screen").toEqual([]);

  // Restore the older one: the state before is kept as a version first.
  const before = Number(sql(`select version from public.editor_document where object_id = '${pageId}'`));
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByText("Restored. The previous state was saved as a version.")).toBeVisible();
  await expect.poll(() => documentText(pageId)).toBe("Plan the gala dinner.\nBudget review in May.");
  expect(Number(sql(`select version from public.editor_document where object_id = '${pageId}'`))).toBe(before + 1);
  expect(sql(`select count(*) from public.object_version where object_id = '${pageId}' and kind = 'restore'`)).toBe("1");
  expect(
    sql(`select string_agg(block_id, ',' order by position) from public.block where object_id = '${pageId}'`),
  ).toBe("intro,budget");

  // The page opens on the restored content.
  await page.goto(`/pages/${pageId}`);
  const restored = page.getByRole("textbox", { name: "Document content" });
  await expect(restored.getByText("Plan the gala dinner.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(restored.getByText("Invite sponsors.")).toHaveCount(0);
  expect(await seriousAxe(page, "#page-collab"), "axe on the page with its collaboration panel").toEqual([]);

  // French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
  await page.reload();
  const fr = page.getByRole("region", { name: "Discussion et historique" });
  await expect(fr.getByRole("tab", { name: "Commentaires" })).toBeVisible();
  await fr.getByRole("tab", { name: "Versions" }).click();
  await expect(fr.getByRole("button", { name: "Enregistrer une version" })).toBeVisible();
  expect(await seriousAxe(page, "#page-collab"), "axe on the page collaboration panel in French").toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });
});

test("a block comment stays anchored after blocks move [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 8);
  const pageId = seedPage(`Anchors ${suffix}`, [
    paragraph("first", "First block."),
    paragraph("second", "Second block with the figure."),
    paragraph("third", "Third block."),
  ]);

  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 30_000 });
  const collab = page.getByRole("region", { name: "Discussion and history" });
  const commentOnBlock = collab.getByRole("button", { name: "Comment on this block" });
  await expect(commentOnBlock).toBeDisabled();

  // The cursor picks the block; its own thread opens.
  await caretAtEnd(page, "second");
  await expect(commentOnBlock).toBeEnabled();
  await commentOnBlock.click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}\\?block=second`));
  await expect(collab.getByRole("heading", { name: /Comments on this block/ })).toBeVisible();
  await collab.getByRole("textbox", { name: "Comment" }).fill("Check this figure.");
  await collab.getByRole("button", { name: "Post comment" }).click();
  await expect(collab.getByText("Check this figure.")).toBeVisible();
  // The text is also in the comment box until the save returns, so wait for
  // the box to clear and for the row before reading where it was anchored.
  await expect(collab.getByRole("textbox", { name: "Comment" })).toHaveValue("");
  await expect
    .poll(() => sql(`select block_id || ':' || parent_type from public.record_comment where parent_id = '${pageId}'`))
    .toBe("second:page");

  // Move the commented block to the top from the keyboard.
  await caretAtEnd(page, "second");
  await page.keyboard.press("Control+Shift+ArrowUp");
  await expect
    .poll(() => sql(`select content -> 'blocks' -> 0 ->> 'id' from public.editor_document where object_id = '${pageId}'`), {
      timeout: 30_000,
    })
    .toBe("second");
  expect(sql(`select position || ':' || text from public.block where object_id = '${pageId}' and block_id = 'second'`)).toBe(
    "1:Second block with the figure.",
  );

  // The comment is still on that block, and only on that block.
  await page.goto(`/pages/${pageId}?block=second`);
  await expect(page.getByRole("region", { name: "Discussion and history" }).getByText("Check this figure.")).toBeVisible();
  await page.goto(`/pages/${pageId}?block=first`);
  const other = page.getByRole("region", { name: "Discussion and history" });
  await expect(other.getByText("No comments yet.")).toBeVisible();
  await expect(other.getByText("Check this figure.")).toHaveCount(0);
  await other.getByRole("link", { name: "All comments" }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}#page-collab$`));
  // The page-wide view lists the block's thread, which leads back to it.
  const threads = page.getByRole("navigation", { name: "Comments on blocks" });
  await threads.getByRole("link", { name: "“Second block with the figure.”: 1 open" }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}\\?block=second`));
  await expect(page.getByRole("region", { name: "Discussion and history" }).getByText("Check this figure.")).toBeVisible();
  expect(await seriousAxe(page, "#page-collab"), "axe on the page with a block thread").toEqual([]);
});

test("a volunteer cannot comment on a workspace page they cannot see [switches on]", async ({ page }) => {
  const pageId = seedPage(`Staff only ${randomUUID().slice(0, 8)}`, [paragraph("only", "Internal notes.")]);
  sql(`
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
    select organization_id, 'page', '${pageId}', '${STAFF}', 'Staff discussion'
    from public.page where id = '${pageId}';
  `);

  await signIn(page, "volunteer");
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByText("Not found — or not yours to see")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
  await expect(page.getByText("Staff discussion")).toHaveCount(0);

  // The generic collaboration screen refuses it too.
  await page.goto(`/collab/objects/${pageId}?type=page`);
  await expect(page.getByText("This object does not exist or you can't open it.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveCount(0);

  // So does the version history.
  await page.goto(`/collab/versions/${pageId}?type=page`);
  await expect(page.getByText("This item does not exist or you can't open it.")).toBeVisible();
});
