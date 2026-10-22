import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Message actions by keyboard. The toolbar on each message (Add reaction,
 * Reply in thread, Message actions) used to be display:none until the mouse
 * hovered the message, and a plain-text message has nothing else to focus,
 * so Tab could never reach it and screen readers never saw it.
 */

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

function organizationId() {
  return sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1;`)
    .split("\n")[0];
}

/** A private channel for owner and volunteer with one message and one thread reply. */
function channelWithMessage() {
  const org = organizationId();
  const channelId = randomUUID();
  const rootId = randomUUID();
  const suffix = channelId.slice(0, 8);
  sql(`
    insert into channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
    values ('${channelId}', '${org}', 'Keyboard ${suffix}', 'keyboard-${suffix}', 'custom', 'private',
            '${OWNER_ID}', '${OWNER_ID}');
    insert into channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
    select '${org}', '${channelId}', u, 'member', 'direct', '${OWNER_ID}'
    from unnest(array['${OWNER_ID}'::uuid, '${VOLUNTEER_ID}'::uuid]) as u;
    insert into message (id, organization_id, channel_id, author_id, body)
    values ('${rootId}', '${org}', '${channelId}', '${OWNER_ID}', 'Plain text root ${suffix}');
    insert into message (organization_id, channel_id, thread_root_id, author_id, body, created_at)
    values ('${org}', '${channelId}', '${rootId}', '${OWNER_ID}', 'Plain text reply ${suffix}',
            now() + interval '1 second');
  `);
  return { channelId, suffix };
}

function conversationWithMessage() {
  const org = organizationId();
  const conversationId = randomUUID();
  const suffix = conversationId.slice(0, 8);
  sql(`
    insert into conversation (id, organization_id, created_by)
    values ('${conversationId}', '${org}', '${OWNER_ID}');
    insert into conversation_member (conversation_id, user_id)
    values ('${conversationId}', '${OWNER_ID}'), ('${conversationId}', '${VOLUNTEER_ID}');
    insert into message (organization_id, conversation_id, author_id, body)
    values ('${org}', '${conversationId}', '${OWNER_ID}', 'Plain text direct ${suffix}');
  `);
  return { conversationId, suffix };
}

/** Accessible name of the focused element, the way the tests below name buttons. */
function focusedName(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "";
  });
}

/**
 * Shift+Tab backwards from the composer until `name` has focus, collecting
 * every name passed. Returns them; fails if `name` is never reached.
 */
async function tabBackTo(page: Page, from: Locator, name: string, limit = 40) {
  await from.focus();
  const passed: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Shift+Tab");
    const current = await focusedName(page);
    passed.push(current);
    if (current === name) return passed;
  }
  throw new Error(`"${name}" was never reached by keyboard; passed: ${passed.join(" | ")}`);
}

/** The focused element can be seen: no ancestor fades it out. */
async function expectFocusedVisible(page: Page) {
  const opacity = await page.evaluate(() => {
    let el = document.activeElement as HTMLElement | null;
    let value = 1;
    while (el) {
      value *= Number(getComputedStyle(el).opacity);
      el = el.parentElement;
    }
    return value;
  });
  expect(opacity, "the focused message action is visible").toBe(1);
}

async function expectNoSeriousAxe(page: Page) {
  const result = await new AxeBuilder({ page }).include('[role="log"]').analyze();
  const serious = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("message actions in a channel and its thread are reachable by keyboard", async ({ page }) => {
  test.setTimeout(90_000);
  const { channelId, suffix } = channelWithMessage();
  await signIn(page, "volunteer");
  await page.goto(`/channels/${channelId}`);
  await expect(page.getByText(`Plain text root ${suffix}`)).toBeVisible();
  // Mouse away from every message, so nothing is revealed by hover.
  await page.mouse.move(0, 0);

  const composer = page.getByRole("textbox", { name: "Write a message…" });
  const passed = await tabBackTo(page, composer, "Message actions");
  await expectFocusedVisible(page);
  await page.keyboard.press("Shift+Tab");
  expect(await focusedName(page)).toBe("Reply in thread");
  await expectFocusedVisible(page);
  await page.keyboard.press("Shift+Tab");
  expect(await focusedName(page)).toBe("Add reaction");
  await expectFocusedVisible(page);
  expect(passed.length).toBeLessThan(40);

  // The reaction picker opens by keyboard, closes on Escape, and gives focus back.
  await page.keyboard.press("Enter");
  const addReaction = page.getByRole("button", { name: "Add reaction" }).first();
  await expect(addReaction).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("React with 👍");
  await page.keyboard.press("Escape");
  await expect(addReaction).toHaveAttribute("aria-expanded", "false");
  expect(await focusedName(page)).toBe("Add reaction");

  // A click elsewhere closes it too.
  await page.keyboard.press("Enter");
  await expect(addReaction).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("log").click({ position: { x: 5, y: 5 } });
  await expect(addReaction).toHaveAttribute("aria-expanded", "false");

  await expectNoSeriousAxe(page);

  // Open the thread by keyboard; the reply's actions are reachable from its composer.
  await tabBackTo(page, composer, "Reply in thread");
  await page.keyboard.press("Enter");
  const thread = page.getByRole("complementary", { name: "Thread" });
  await expect(thread.getByText(`Plain text reply ${suffix}`)).toBeVisible();
  await page.mouse.move(0, 0);
  await tabBackTo(page, thread.getByRole("textbox"), "Message actions");
  await expectFocusedVisible(page);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await focusedName(page)).toBe("Message actions");
});

test("message actions in a direct message are reachable by keyboard", async ({ page }) => {
  test.setTimeout(90_000);
  const { conversationId, suffix } = conversationWithMessage();
  await signIn(page, "volunteer");
  await page.goto(`/messages/${conversationId}`);
  await expect(page.getByText(`Plain text direct ${suffix}`)).toBeVisible();
  await page.mouse.move(0, 0);

  await tabBackTo(page, page.getByRole("textbox", { name: "Write a message…" }), "Message actions");
  await expectFocusedVisible(page);
  await page.keyboard.press("Shift+Tab");
  expect(await focusedName(page)).toBe("Reply in thread");
  await page.keyboard.press("Shift+Tab");
  expect(await focusedName(page)).toBe("Add reaction");
  await expectFocusedVisible(page);

  await expectNoSeriousAxe(page);
});
