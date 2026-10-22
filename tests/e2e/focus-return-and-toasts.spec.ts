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

/** Arrow down the open menu until `name` has focus. */
async function moveTo(page: Page, name: string) {
  const item = page.getByRole("menuitem", { name });
  for (let i = 0; i < 10; i += 1) {
    if (await item.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
}

test("focus returns to the menu button after a menu action and after a dialog it opened", async ({ page }) => {
  test.setTimeout(90_000);
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

  await signIn(page, "staff");
  await page.goto(`/channels/${channelId}`);
  await expect(page.getByText(`Focus target ${suffix}`)).toBeVisible();
  const trigger = page.getByRole("button", { name: "Message actions" });

  // A plain action: save the message.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await moveTo(page, "Save message");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await focusedName(page)).toBe("Message actions");

  // An action that opens a dialog: Escape returns to the menu button.
  await page.keyboard.press("Enter");
  await moveTo(page, "Record as decision");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record decision" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await focusedName(page)).toBe("Message actions");
});

test("a toast raised in the task drawer shows above it on a phone and is announced", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const org = organizationId();
  const title = `Toast drawer ${randomUUID().slice(0, 8)}`;
  const taskId = sql(`
    insert into task (organization_id, title, created_by, assignee_id)
    values ('${org}', '${title}', '${STAFF_ID}', '${STAFF_ID}') returning id;
  `).split("\n")[0];

  await signIn(page, "staff");
  await page.goto(`/my-work?task=${taskId}`);
  const drawer = page.getByRole("dialog", { name: title });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await drawer.getByRole("button", { name: "Copy link to this task" }).click();

  const toast = page.getByRole("status").filter({ hasText: "Link copied" });
  await expect(toast).toBeVisible();
  // Drawn on top: the point at the toast's centre belongs to the toast.
  const onTop = await toast.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && el.contains(hit));
  });
  expect(onTop, "the toast is not covered by the drawer").toBe(true);

  // Announced: the accessibility tree has a status node that is not ignored.
  const cdp = await context.newCDPSession(page);
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
    nodes: { ignored: boolean; role?: { value?: string }; name?: { value?: string } }[];
  };
  const exposed = nodes.filter((n) => !n.ignored && n.role?.value === "status");
  expect(exposed.length, "a status node is exposed while the drawer is open").toBeGreaterThan(0);

  await context.close();
});
