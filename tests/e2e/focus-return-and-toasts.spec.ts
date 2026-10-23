import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Focus after a menu action, and toasts raised while a dialog is open.
 *
 * A menu item used to run its action and then close the menu without giving
 * focus back, so the focused item vanished and keyboard users landed at the
 * top of the page; a dialog opened from the menu recorded <body> as the place
 * to return to. Toasts were drawn behind every modal dialog and drawer (the
 * platform makes everything outside an open modal inert), so a save failure in
 * the task drawer was neither visible on a phone nor announced.
 *
 * Each check runs in English and French, with axe on the open dialog or
 * drawer: focus back on the menu button after an action and after a dialog
 * it opened, focus back on the task after its drawer closes, a toast on top
 * of the drawer and exposed to assistive technology, and an error toast
 * raised as an alert (assertive) rather than a polite status.
 */

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

function organizationId() {
  return sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1;`)
    .split("\n")[0];
}

function focusedName(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute("aria-label") ?? el?.tagName ?? "";
  });
}

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const TEXT = {
  en: {
    actions: "Message actions",
    save: "Save message",
    record: "Record as decision",
    recordTitle: "Record decision",
    copyLink: "Copy link to this task",
    copied: "Link copied",
    commentFailed: "Could not post the comment.",
  },
  fr: {
    actions: "Actions sur le message",
    save: "Enregistrer le message",
    record: "Consigner comme décision",
    recordTitle: "Consigner la décision",
    copyLink: "Copier le lien vers cette tâche",
    copied: "Lien copié",
    commentFailed: "Le commentaire n’a pas pu être publié.",
  },
} as const;

/** French is a cookie the app reads on each request; set after sign-in. */
async function useLanguage(page: Page, lang: "en" | "fr") {
  if (lang === "fr") {
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  }
}

/**
 * Arrow down the open menu until `name` has focus. Each press waits for the
 * focus to move (or for the last item) before the next, so a slow render
 * cannot make a press land before the menu has taken focus.
 */
async function moveTo(page: Page, name: string) {
  const item = page.getByRole("menuitem", { name, exact: true });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  for (let i = 0; i < 12; i += 1) {
    if (await item.evaluate((el) => el === document.activeElement)) return;
    const before = await page.evaluate(() => document.activeElement?.textContent ?? "");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(
      (previous) => (document.activeElement?.textContent ?? "") !== previous || !document.activeElement?.closest("[role=menu]"),
      before,
      { timeout: 2_000 },
    ).catch(() => undefined);
  }
  await expect(item).toBeFocused();
}

/** The toast region sits in an open modal's top layer, so the toast is on top. */
async function expectOnTop(locator: ReturnType<Page["getByRole"]>) {
  const onTop = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && el.contains(hit));
  });
  expect(onTop, "the toast is not covered by the drawer").toBe(true);
}

function seedChannel() {
  const org = organizationId();
  const channelId = randomUUID();
  const suffix = channelId.slice(0, 8);
  sql(`
    insert into channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
    values ('${channelId}', '${org}', 'Focus ${suffix}', 'focus-${suffix}', 'custom', 'private',
            '${OWNER_ID}', '${OWNER_ID}');
    insert into channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
    select '${org}', '${channelId}', u, 'member', 'direct', '${OWNER_ID}'
    from unnest(array['${OWNER_ID}'::uuid, '${STAFF_ID}'::uuid]) as u;
    insert into message (organization_id, channel_id, author_id, body)
    values ('${org}', '${channelId}', '${OWNER_ID}', 'Focus target ${suffix}');
  `);
  return { channelId, suffix };
}

function seedTask(prefix: string) {
  const title = `${prefix} ${randomUUID().slice(0, 8)}`;
  const id = sql(`
    insert into task (organization_id, title, created_by, assignee_id)
    values ('${organizationId()}', '${title}', '${STAFF_ID}', '${STAFF_ID}') returning id;
  `).split("\n")[0];
  return { id, title };
}

for (const lang of ["en", "fr"] as const) {
  const text = TEXT[lang];

  test(`focus returns to the menu button after a menu action and after a dialog it opened (${lang})`, async ({ page }) => {
    test.setTimeout(90_000);
    const { channelId, suffix } = seedChannel();
    await signIn(page, "staff");
    await useLanguage(page, lang);
    await page.goto(`/channels/${channelId}`);
    await expect(page.getByText(`Focus target ${suffix}`)).toBeVisible();
    const trigger = page.getByRole("button", { name: text.actions });

    // A plain action: save the message.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await moveTo(page, text.save);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await focusedName(page)).toBe(text.actions);

    // An action that opens a dialog: axe on the open dialog, then Escape
    // returns to the menu button.
    await page.keyboard.press("Enter");
    await moveTo(page, text.record);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: text.recordTitle });
    await expect(dialog).toBeVisible();
    const axe = await new AxeBuilder({ page }).include("dialog[open]").withTags(WCAG).analyze();
    expect(axe.violations, "axe on the dialog opened from the menu").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await focusedName(page)).toBe(text.actions);
  });

  test(`focus returns to the task after its drawer closes (${lang})`, async ({ page }) => {
    test.setTimeout(90_000);
    const { title } = seedTask("Drawer focus");
    await signIn(page, "staff");
    await useLanguage(page, lang);
    await page.goto("/my-work");
    const row = page.getByRole("button", { name: new RegExp(`^${title}`) });
    await row.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: title });
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(row).toBeFocused();
  });

  test(`a toast raised in the task drawer shows above it on a phone and is announced (${lang})`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const { id, title } = seedTask("Toast drawer");

    await signIn(page, "staff");
    await useLanguage(page, lang);
    await page.goto(`/my-work?task=${id}`);
    const drawer = page.getByRole("dialog", { name: title });
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await drawer.getByRole("button", { name: text.copyLink }).click();

    const toast = page.getByRole("status").filter({ hasText: text.copied });
    await expect(toast).toBeVisible();
    await expectOnTop(toast);

    // Announced: the accessibility tree has a status node that is not ignored.
    const cdp = await context.newCDPSession(page);
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: { ignored: boolean; role?: { value?: string }; name?: { value?: string } }[];
    };
    const exposed = nodes.filter((n) => !n.ignored && n.role?.value === "status");
    expect(exposed.length, "a status node is exposed while the drawer is open").toBeGreaterThan(0);

    const axe = await new AxeBuilder({ page }).include("dialog[open]").withTags(WCAG).analyze();
    expect(axe.violations, "axe on the drawer with its toast").toEqual([]);
    await context.close();
  });

  test(`an error toast in the task drawer interrupts, as an alert (${lang})`, async ({ page }) => {
    test.setTimeout(90_000);
    const { id, title } = seedTask("Toast error");
    await signIn(page, "staff");
    await useLanguage(page, lang);
    await page.goto(`/my-work?task=${id}`);
    const drawer = page.getByRole("dialog", { name: title });
    await expect(drawer).toBeVisible({ timeout: 30_000 });

    // The task disappears while the drawer is open, so the comment fails.
    sql(`delete from task where id = '${id}';`);
    const box = drawer.getByRole("textbox").last();
    await box.fill("This comment cannot be posted");
    await box.press("Enter");
    const submit = drawer.locator("form button[type=submit]").last();
    if (await submit.isVisible()) await submit.click();

    // An error is an alert (assertive), not a polite status, and it stays.
    const alert = page.getByRole("alert").filter({ hasText: text.commentFailed });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status").filter({ hasText: text.commentFailed })).toHaveCount(0);
    await expectOnTop(alert);
  });
}
