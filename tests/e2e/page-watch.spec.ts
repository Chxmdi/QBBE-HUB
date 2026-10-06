import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit C3: watched pages and notifications, behind the `wos_pages`
 * switch (the page editor also needs `wos_editor`). A person watches a page
 * and hears about comments and replies on it; a mention is one notice; each
 * notification category can be kept out of the Hub and that is honoured; a
 * block comment stays on its block while blocks above it change.
 */

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

const pmId = () => sql(`select id from public.user_profile where email = 'qa-pm@example.com'`);
const pmName = () => sql(`select full_name from public.user_profile where email = 'qa-pm@example.com'`);

/** Pages this file made, so their notices can be cleared afterwards. */
const seeded: string[] = [];

test.describe.configure({ mode: "serial" });
test.afterAll(() => {
  switches(false);
  sql(`update public.notification_preference set hub_muted_categories = '{}' where user_id = '${STAFF}'`);
  if (seeded.length === 0) return;
  // Leave the email queue as it was found: other specs drain it in batches.
  const ids = seeded.map((id) => `'${id}'`).join(", ");
  sql(`
    delete from pgmq.q_notifications q using public.notification n
    where q.message ->> 'notification_id' = n.id::text and n.source_id in (${ids});
    delete from public.notification where source_id in (${ids});
  `);
});

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
  const id = sql(`
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
  seeded.push(id);
  return id;
}

/** A comment on the page by someone, written straight to the database (the trigger still runs). */
function commentAs(author: string, pageId: string, body: string, parent?: string): string {
  return sql(`
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, parent_comment_id)
    select organization_id, 'page', id, '${author}', '${body.replace(/'/g, "''")}', ${parent ? `'${parent}'` : "null"}
    from public.page where id = '${pageId}'
    returning id;
  `);
}

/**
 * The id of a comment once it is saved. The comment box keeps its text until
 * the save returns, and that text alone would already satisfy a getByText
 * check, so the database is asked until the row is there.
 */
async function savedComment(where: string): Promise<string> {
  let id = "";
  await expect.poll(() => (id = sql(`select id from public.record_comment where ${where}`)), { timeout: 30_000 }).not.toBe("");
  return id;
}

const noticesFor = (user: string, commentId: string) =>
  sql(`select coalesce(string_agg(category, ',' order by category), '') from public.notification
       where user_id = '${user}' and dedupe_key = 'page_comment:${commentId}:${user}'`);

async function seriousAxe(page: Page, within?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const results = await (within ? builder.include(within) : builder).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)}`));
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("qbbe-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
}

/** Puts the caret at the end of a one-line block. */
async function caretAtEnd(page: Page, blockId: string) {
  const block = page.locator(`.qbbe-editor [data-id="${blockId}"] [data-content-type]`).first();
  const box = await block.boundingBox();
  if (!box) throw new Error(`block ${blockId} not visible`);
  await block.click({ position: { x: box.width - 4, y: box.height / 2 } });
  // The editor learns where the caret is from a selectionchange that arrives a
  // task after the click; a key pressed before it lands where the caret was
  // (seen in CI: Enter after "first" made the new block after "third").
  await expect
    .poll(() => block.evaluate((el) => el.contains(document.getSelection()?.anchorNode ?? null)))
    .toBe(true);
  await block.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await page.keyboard.press("End");
}

const blockOrder = (pageId: string) =>
  sql(`select string_agg(b ->> 'id', ',' order by n) from public.editor_document d,
       jsonb_array_elements(d.content -> 'blocks') with ordinality as t(b, n) where d.object_id = '${pageId}'`);

test("the watch button and the new preferences are hidden while the switch is off [switch off]", async ({ page }) => {
  switches(false);
  const pageId = seedPage(`Hidden ${randomUUID().slice(0, 8)}`, [paragraph("only", "Nothing to see.")]);
  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Not found — or not yours to see" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch", exact: true })).toHaveCount(0);

  await page.goto("/settings/notifications");
  await expect(page.getByLabel("Work assigned to me")).toBeVisible();
  await expect(page.getByText("Everything still appears in the Hub either way.")).toBeVisible();
  await expect(page.getByText("Tasks, reviews, and decisions. Approvals follow this choice.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Watched pages", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Replies to my comments", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Show in the Hub" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Watched pages", exact: true })).toHaveCount(0);
});

test("watch a page, hear about comments and replies, and unwatch [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  switches(true);
  const title = `Budget ${randomUUID().slice(0, 8)}`;
  const pageId = seedPage(title, [paragraph("intro", "The budget for the gala.")]);
  const pm = pmId();
  const name = pmName();

  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 30_000 });
  const watch = page.getByRole("button", { name: "Watch", exact: true });
  await expect(watch).toHaveAttribute("aria-pressed", "false");
  // While the save is on its way the button says it is busy, and stays focusable.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/pages/${pageId}`, async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await watch.click();
  await expect(watch).toHaveAttribute("aria-busy", "true");
  await expect(watch).toBeEnabled();
  release();
  await expect(page.getByText("You're watching this page. New comments will reach you.")).toBeVisible();
  await expect(watch).toHaveAttribute("aria-busy", "false");
  await page.unroute(`**/pages/${pageId}`);
  await expect(watch).toHaveAttribute("aria-pressed", "true");
  expect(sql(`select count(*) from public.page_watch where page_id = '${pageId}' and user_id = '${STAFF}'`)).toBe("1");
  await page.reload();
  await expect(page.getByRole("button", { name: "Watch", exact: true })).toHaveAttribute("aria-pressed", "true");

  // The staff member starts a thread, so a reply can answer it.
  const collab = page.getByRole("region", { name: "Discussion and history" });
  await collab.getByRole("textbox", { name: "Comment" }).fill("Can someone check the totals?");
  await collab.getByRole("button", { name: "Post comment" }).click();
  await expect(collab.getByText("Can someone check the totals?")).toBeVisible();
  await expect(collab.getByRole("textbox", { name: "Comment" })).toHaveValue("");
  const question = await savedComment(`parent_id = '${pageId}' and body = 'Can someone check the totals?'`);
  expect(noticesFor(STAFF, question), "nobody is told about their own comment").toBe("");

  // A colleague comments and replies from their own session.
  await signOut(page);
  await signIn(page, "pm");
  await page.goto(`/pages/${pageId}`);
  const theirs = page.getByRole("region", { name: "Discussion and history" });
  await expect(theirs.getByText("Can someone check the totals?")).toBeVisible({ timeout: 30_000 });
  await theirs.getByRole("textbox", { name: "Comment" }).fill("The venue cost went up.");
  await theirs.getByRole("button", { name: "Post comment" }).click();
  await expect(theirs.getByText("The venue cost went up.")).toBeVisible();
  await theirs.getByRole("button", { name: /^Reply to QA Staff/ }).first().click();
  await theirs.getByRole("textbox", { name: /^Reply to QA Staff/ }).fill("Totals checked.");
  await theirs.getByRole("button", { name: "Post reply" }).click();
  await expect(theirs.getByText("Totals checked.")).toBeVisible();
  const comment = await savedComment(`parent_id = '${pageId}' and body = 'The venue cost went up.'`);
  const reply = await savedComment(`parent_id = '${pageId}' and body = 'Totals checked.' and parent_comment_id = '${question}'`);
  expect(noticesFor(STAFF, comment)).toBe("watched_page");
  expect(noticesFor(STAFF, reply)).toBe("comment");

  // The watcher sees both in their inbox and lands on the comment.
  await signOut(page);
  await signIn(page, "staff");
  await page.goto("/inbox");
  const replied = page.getByText(`${name} replied to your comment on “${title}”`);
  await expect(replied).toBeVisible();
  await expect(page.getByText(`${name} commented on “${title}”`)).toBeVisible();
  await page.getByRole("link", { name: new RegExp(`${name} commented on “${title}”`) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}#comment-${comment}$`));

  // Unwatch from the keyboard; later comments no longer reach the person.
  const button = page.getByRole("button", { name: "Watch", exact: true });
  await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("You stopped watching this page.")).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toBeFocused();
  expect(sql(`select count(*) from public.page_watch where page_id = '${pageId}'`)).toBe("0");
  const later = commentAs(pm, pageId, "Another update.");
  expect(noticesFor(STAFF, later)).toBe("");
  // A reply to the person's own comment still reaches them: it is about them.
  const laterReply = commentAs(pm, pageId, "One more answer.", question);
  expect(noticesFor(STAFF, laterReply)).toBe("comment");

  // Accessible in both themes, in French, and at 320 px without sideways scrolling.
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousAxe(page, "article"), `${theme}: page header with the watch button`).toEqual([]);
  }
  await setTheme(page, "light");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.reload();
  const suivre = page.getByRole("button", { name: "Suivre", exact: true });
  await expect(suivre).toHaveAttribute("aria-pressed", "false");
  await suivre.click();
  await expect(page.getByText("Vous suivez cette page. Les nouveaux commentaires vous parviendront.")).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("Page suivie").first()).toBeVisible();
  await expect(page.getByText("Commentaire", { exact: true }).first()).toBeVisible();
  await page.context().clearCookies({ name: "qbbe-locale" });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/pages/${pageId}`);
  const narrow = page.getByRole("button", { name: "Watch", exact: true });
  await expect(narrow).toBeVisible({ timeout: 30_000 });
  // The header row holding the button fits, and so does the button. (The
  // page's discussion tab bar is checked by its own unit's spec.)
  const box = await narrow.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
  expect(
    await narrow.evaluate((button) => {
      const row = button.closest("article > div");
      return row !== null && row.scrollWidth <= row.clientWidth && row.getBoundingClientRect().right <= 320;
    }),
  ).toBe(true);
});

test("a mention in a page comment notifies the mentioned person once [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  switches(true);
  const title = `Mentions ${randomUUID().slice(0, 8)}`;
  const pageId = seedPage(title, [paragraph("intro", "Who signs the contract?")]);
  // The staff member watches the page too: the mention must still be one notice.
  sql(`insert into public.page_watch (page_id, user_id) values ('${pageId}', '${STAFF}')`);

  await signIn(page, "pm");
  await page.goto(`/pages/${pageId}`);
  const collab = page.getByRole("region", { name: "Discussion and history" });
  const box = collab.getByRole("textbox", { name: "Comment" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.click();
  await box.pressSequentially("Over to @QA Sta");
  await page.getByRole("listbox", { name: "Mention suggestions" }).getByRole("option", { name: "Person: QA Staff" }).click();
  await box.pressSequentially("and @QA Vol");
  await page.getByRole("listbox", { name: "Mention suggestions" }).getByRole("option", { name: "Person: QA Volunteer" }).click();
  await collab.getByRole("button", { name: "Post comment" }).click();
  await expect(collab.getByText("@QA Volunteer")).toBeVisible();
  const comment = await savedComment(`parent_id = '${pageId}'`);

  // Exactly one notice for the mentioned watcher: the mention.
  await expect
    .poll(() => sql(`select string_agg(category, ',') from public.notification where user_id = '${STAFF}' and source_id = '${pageId}'`))
    .toBe("mention");
  expect(noticesFor(STAFF, comment)).toBe("");
  // The volunteer cannot open a workspace page, so is told nothing.
  expect(sql(`select count(*) from public.notification where user_id = '${VOLUNTEER}' and (source_id = '${pageId}' or link like '/pages/${pageId}%')`)).toBe("0");

  await signOut(page);
  await signIn(page, "staff");
  await page.goto("/inbox");
  // One inbox item for this page: the mention.
  const links = page.getByRole("region", { name: "Notifications" }).locator(`a[href^="/pages/${pageId}"]`);
  await expect(links).toHaveCount(1);
  await expect(links).toHaveText(new RegExp(`^${pmName()} mentioned you in a comment$`));
});

test("each notification category can be kept out of the Hub, and that is honoured [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  switches(true);
  const pageId = seedPage(`Preferences ${randomUUID().slice(0, 8)}`, [paragraph("intro", "Weekly plan.")]);
  sql(`insert into public.page_watch (page_id, user_id) values ('${pageId}', '${STAFF}')`);
  const pm = pmId();

  await signIn(page, "staff");
  await page.goto("/settings/notifications");
  // The page no longer promises that everything reaches the Hub, nor that approvals follow assigned work.
  await expect(page.getByText("Under “Show in the Hub”, choose what appears in the Hub.")).toBeVisible();
  await expect(page.getByText("Everything still appears in the Hub either way.")).toHaveCount(0);
  await expect(page.getByText("Approvals follow this choice.")).toHaveCount(0);
  // Email choices for each category, and each one can be kept out of the Hub.
  for (const label of ["Mentions and replies", "Work assigned to me", "Replies to my comments", "Approvals", "Watched pages"]) {
    await expect(page.getByRole("combobox", { name: label, exact: true })).toBeVisible();
  }
  const hub = page.getByRole("group", { name: "Show in the Hub" });
  for (const label of ["Mentions", "Assigned work", "Comments", "Approvals", "Watched pages"]) {
    await expect(hub.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
  }
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousAxe(page, "main"), `${theme}: notification preferences`).toEqual([]);
  }
  await setTheme(page, "light");

  // Keep watched pages out of the Hub; send replies in the daily digest.
  await hub.getByRole("checkbox", { name: "Watched pages", exact: true }).uncheck();
  await page.getByRole("combobox", { name: "Replies to my comments", exact: true }).selectOption({ label: "Daily digest" });
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  expect(sql(`select hub_muted_categories::text || ' ' || (category_modes ->> 'comment') from public.notification_preference where user_id = '${STAFF}'`)).toBe(
    "{watched_page} daily",
  );
  await page.reload();
  await expect(hub.getByRole("checkbox", { name: "Watched pages", exact: true })).not.toBeChecked();
  await expect(page.getByRole("combobox", { name: "Replies to my comments", exact: true })).toHaveValue("daily");

  // A comment on the watched page is not written for them; a reply to them still is.
  const question = commentAs(STAFF, pageId, "Is the plan final?");
  const muted = commentAs(pm, pageId, "Not yet.");
  expect(noticesFor(STAFF, muted)).toBe("");
  const reply = commentAs(pm, pageId, "Final now.", question);
  expect(noticesFor(STAFF, reply)).toBe("comment");

  // Keep replies out too, by keyboard; then turn watched pages back on.
  const comments = hub.getByRole("checkbox", { name: "Comments", exact: true });
  await comments.focus();
  await page.keyboard.press("Space");
  await expect(comments).not.toBeChecked();
  await hub.getByRole("checkbox", { name: "Watched pages", exact: true }).check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  expect(sql(`select hub_muted_categories::text from public.notification_preference where user_id = '${STAFF}'`)).toBe("{comment}");
  expect(noticesFor(STAFF, commentAs(pm, pageId, "Reply again.", question))).toBe("");
  expect(noticesFor(STAFF, commentAs(pm, pageId, "A new thought."))).toBe("watched_page");

  // French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.reload();
  const hubFr = page.getByRole("group", { name: "Afficher dans le Hub" });
  await expect(hubFr.getByRole("checkbox", { name: "Pages suivies", exact: true })).toBeChecked();
  await expect(hubFr.getByRole("checkbox", { name: "Commentaires", exact: true })).not.toBeChecked();
  await expect(page.getByRole("combobox", { name: "Réponses à mes commentaires", exact: true })).toBeVisible();
  await page.context().clearCookies({ name: "qbbe-locale" });
  sql(`update public.notification_preference set hub_muted_categories = '{}' where user_id = '${STAFF}'`);
});

test("a block comment stays on its block while blocks above it are added, moved and removed [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  switches(true);
  const pageId = seedPage(`Anchors ${randomUUID().slice(0, 8)}`, [
    paragraph("first", "First block."),
    paragraph("second", "Second block."),
    paragraph("third", "Third block with the figure."),
  ]);

  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 30_000 });
  const collab = page.getByRole("region", { name: "Discussion and history" });
  await caretAtEnd(page, "third");
  await collab.getByRole("button", { name: "Comment on this block" }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}\\?block=third`));
  await collab.getByRole("textbox", { name: "Comment" }).fill("Check this figure.");
  await collab.getByRole("button", { name: "Post comment" }).click();
  await expect(collab.getByRole("textbox", { name: "Comment" })).toHaveValue("");
  await expect(collab.getByText("Check this figure.")).toBeVisible();

  // Added above: a new block after the first one.
  await caretAtEnd(page, "first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Inserted above.");
  await expect.poll(() => blockOrder(pageId), { timeout: 30_000 }).toMatch(/^first,[^,]+,second,third$/);

  // Moved above: the first block moves down one place, still above.
  await caretAtEnd(page, "first");
  await page.keyboard.press("Control+Shift+ArrowDown");
  await expect.poll(() => blockOrder(pageId), { timeout: 30_000 }).toMatch(/^[^,]+,first,second,third$/);

  // Removed above: the second block is emptied and deleted.
  await caretAtEnd(page, "second");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect.poll(() => blockOrder(pageId), { timeout: 30_000 }).toMatch(/^[^,]+,first,third$/);

  // The comment is still on its block, and only there, after a reload.
  expect(sql(`select block_id from public.record_comment where parent_id = '${pageId}'`)).toBe("third");
  expect(sql(`select position || ':' || text from public.block where object_id = '${pageId}' and block_id = 'third'`)).toBe(
    "3:Third block with the figure.",
  );
  await page.reload();
  await expect(page.getByRole("region", { name: "Discussion and history" }).getByText("Check this figure.")).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`/pages/${pageId}?block=first`);
  await expect(page.getByRole("region", { name: "Discussion and history" }).getByText("Check this figure.")).toHaveCount(0);
  await page.goto(`/pages/${pageId}`);
  const threads = page.getByRole("navigation", { name: "Comments on blocks" });
  await threads.getByRole("link", { name: "“Third block with the figure.”: 1 open" }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}\\?block=third`));
  await expect(page.getByRole("region", { name: "Discussion and history" }).getByText("Check this figure.")).toBeVisible();
});
