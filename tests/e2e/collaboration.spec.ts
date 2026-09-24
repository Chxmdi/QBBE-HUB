import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { clickWhenInteractive } from "./interactive";
import { sql } from "./db";

/**
 * Collaboration and notification journeys (#112, QA-FINAL "collaboration",
 * "notifications"): a meeting run end to end, a comment on a project, and a
 * channel @mention that reaches the mentioned person's notifications and can
 * be read there. Channel delivery itself is realtime-delivery.spec.ts.
 */

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

test("a meeting is scheduled, run with agenda, decision and action, and keeps all three", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const title = `Journey planning meeting ${suffix}`;
  const item = `Review the workshop budget ${suffix}`;
  const decision = `Approve the venue deposit ${suffix}`;
  const action = `Book the community hall ${suffix}`;

  await signIn(page, "owner");
  await page.goto("/meetings");
  await clickWhenInteractive(page.getByRole("button", { name: "New meeting" }));
  const schedule = page.getByRole("dialog", { name: "Schedule meeting" });
  await schedule.getByLabel("Title").fill(title);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await schedule.getByLabel("Starts").fill(`${tomorrow}T10:00`);
  await schedule.getByRole("button", { name: "Schedule" }).click();
  await expect(schedule).toBeHidden();

  await page.getByRole("link", { name: title }).first().click();
  await expect(page.locator("h1").first()).toHaveText(title);
  const meetingUrl = page.url();

  await page.getByRole("button", { name: "Add item" }).click();
  const agenda = page.getByRole("dialog", { name: "Add agenda item" });
  await agenda.getByLabel("Item").fill(item);
  await agenda.getByRole("button", { name: "Add item" }).click();
  await expect(agenda).toBeHidden();

  await page.getByRole("button", { name: "Record", exact: true }).click();
  const decide = page.getByRole("dialog", { name: "Record decision" });
  await decide.getByLabel("Decision").fill(decision);
  await decide.getByRole("button", { name: "Record decision" }).click();
  await expect(decide).toBeHidden();

  await page.getByRole("button", { name: "Add action" }).click();
  const act = page.getByRole("dialog", { name: "Add action" });
  await act.getByLabel("Action").fill(action);
  await act.getByRole("button", { name: "Create task" }).click();
  await expect(act).toBeHidden();

  await page.goto(meetingUrl);
  await expect(page.getByText(item).first()).toBeVisible();
  await expect(page.getByText(decision).first()).toBeVisible();
  await expect(page.getByText(action).first()).toBeVisible();

  // The action is a real task, not only a line on the meeting.
  expect(sql(`select count(*) from task where title = '${action}'`)).toBe("1");
});

test("a comment on a project is kept and can be resolved", async ({ page }) => {
  test.setTimeout(90_000);
  const body = `Can we confirm the venue before Friday? ${randomUUID().slice(0, 8)}`;
  const projectId = sql(`select id from project where name = 'Fall Community Workshop Series'`);

  await signIn(page, "owner");
  await page.goto(`/projects/${projectId}`);
  await page.getByPlaceholder("Add a comment").fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();

  await page.reload();
  const comment = page.getByRole("listitem").filter({ hasText: body });
  await expect(comment).toBeVisible();
  await comment.getByRole("button", { name: "Resolve" }).click();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: body })).toContainText("resolved");
});

test("an @mention in a channel reaches the mentioned person's notifications and can be read", async ({ page }) => {
  test.setTimeout(120_000);
  const organizationId = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1`);
  const channelId = randomUUID();
  sql(`
    insert into channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
    values ('${channelId}', '${organizationId}', 'Mention journey', 'mention-journey-${channelId.slice(0, 8)}',
            'custom', 'private', '${OWNER_ID}', '${OWNER_ID}');
    insert into channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
    select '${organizationId}', '${channelId}', u, 'member', 'direct', '${OWNER_ID}'
    from unnest(array['${OWNER_ID}'::uuid, '${VOLUNTEER_ID}'::uuid]) as u;
  `);
  // Start from a clean inbox so the one new notification is unambiguous.
  sql(`update notification set read_at = now() where user_id = '${VOLUNTEER_ID}' and read_at is null`);

  const marker = randomUUID().slice(0, 8);
  await signIn(page, "owner");
  await page.goto(`/channels/${channelId}`);
  await page.getByRole("textbox", { name: "Write a message…" }).fill(`@QA Volunteer can you check the room list? ${marker}`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(new RegExp(marker)).first()).toBeVisible();

  await expect
    .poll(() => sql(`select count(*) from notification where user_id = '${VOLUNTEER_ID}' and category = 'mention' and read_at is null`))
    .toBe("1");

  await signOut(page);
  await signIn(page, "volunteer");
  const bell = page.getByRole("button", { name: /^Notifications \(1 unread\)$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole("region", { name: "Notifications" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/QA Owner|mention/i).first()).toBeVisible();
  await panel.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  expect(
    sql(`select count(*) from notification where user_id = '${VOLUNTEER_ID}' and read_at is null`),
    "reading them is stored, not only hidden",
  ).toBe("0");
});

test("a direct message can be started, sent, and read by the other person", async ({ page }) => {
  test.setTimeout(120_000);
  const body = `Are you free to cover Saturday? ${randomUUID().slice(0, 8)}`;

  await signIn(page, "owner");
  await page.goto("/messages");
  await clickWhenInteractive(page.getByRole("button", { name: "New message" }));
  const dialog = page.getByRole("dialog", { name: "Start a conversation" });
  await dialog.getByRole("checkbox", { name: "QA Volunteer" }).check();
  await dialog.getByRole("button", { name: /^Start/ }).click();

  // It used to stop here: "Could not start the conversation." (#112).
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const conversationUrl = new URL(page.url()).pathname;
  await page.getByRole("textbox", { name: "Write a message…" }).fill(body);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(body).first()).toBeVisible();

  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(conversationUrl);
  await expect(page.getByText(body).first()).toBeVisible();
});

test("a private channel can be created, and a volunteer outside it cannot open it", async ({ page }) => {
  test.setTimeout(120_000);
  const name = `journey-private-${randomUUID().slice(0, 8)}`;

  await signIn(page, "owner");
  await page.goto("/channels");
  await clickWhenInteractive(page.getByRole("button", { name: "New channel" }));
  const dialog = page.getByRole("dialog", { name: "Create channel" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("Privacy").selectOption("private");
  await dialog.getByRole("button", { name: "Create channel" }).click();

  // It used to stop here: "Could not create the channel." (#112).
  await expect(page).toHaveURL(/\/channels\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const channelPath = new URL(page.url()).pathname;
  const body = `First post in ${name}`;
  await page.getByRole("textbox", { name: "Write a message…" }).fill(body);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(body).first()).toBeVisible();

  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(channelPath);
  await expect(page.locator("h1").first()).toHaveText(/Not found/);
  await expect(page.getByText(body)).toHaveCount(0);
});
