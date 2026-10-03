import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

const JOB_SECRET = process.env.CRON_JOB_SECRET ?? "";

// A datetime-local value a few days ahead, in the browser's wall-clock time.
function daysAhead(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T09:00`;
}

async function publish(
  page: import("@playwright/test").Page,
  options: { title: string; body: string; requireAck?: boolean; publishAt?: string },
) {
  await page.goto("/announcements");
  await page.getByRole("button", { name: "New announcement" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(options.title);
  await dialog.getByLabel("Announcement", { exact: true }).fill(options.body);
  if (options.requireAck) await dialog.getByLabel("Require acknowledgment").check();
  if (options.publishAt) await dialog.getByLabel("Publish at (optional)").fill(options.publishAt);
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(dialog).toBeHidden();
}

test("an administrator publishes an announcement that staff read and acknowledge", async ({ browser }) => {
  const stamp = Date.now();
  const title = `Office closed ${stamp}`;
  const adminContext = await browser.newContext();
  const staffContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const staff = await staffContext.newPage();
  try {
    await signIn(admin, "owner");
    await publish(admin, { title, body: `Closed on Monday ${stamp}.`, requireAck: true });
    await expect(admin.getByRole("heading", { name: title })).toBeVisible();

    await signIn(staff, "staff");
    await staff.goto("/announcements");
    // Staff cannot publish.
    await expect(staff.getByRole("button", { name: "New announcement" })).toHaveCount(0);
    const card = staff.locator("article").filter({ hasText: title });
    await expect(card.getByText(`Closed on Monday ${stamp}.`)).toBeVisible();
    await expect(card.getByText("Acknowledgment required")).toBeVisible();
    await card.getByRole("button", { name: "Acknowledge" }).click();
    await expect(card.getByText("You acknowledged this")).toBeVisible();

    // The acknowledgement survives a reload, and the administrator's count
    // includes it.
    await staff.reload();
    await expect(
      staff.locator("article").filter({ hasText: title }).getByText("You acknowledged this"),
    ).toBeVisible();
    await admin.reload();
    await expect(
      admin.locator("article").filter({ hasText: title }).getByText(/^1 of \d+ members acknowledged$/),
    ).toBeVisible();
  } finally {
    await adminContext.close();
    await staffContext.close();
  }
});

test("a scheduled announcement stays hidden until the job posts it at its publish time", async ({
  browser,
  request,
}) => {
  if (!JOB_SECRET) throw new Error("CRON_JOB_SECRET is not set; the job cannot be called.");
  const stamp = Date.now();
  const title = `Board news ${stamp}`;
  const body = `The board meets on Friday ${stamp}.`;
  const adminContext = await browser.newContext();
  const staffContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const staff = await staffContext.newPage();
  try {
    await signIn(admin, "owner");
    await publish(admin, { title, body, requireAck: true, publishAt: daysAhead(3) });

    // Nothing of it is readable yet: not on the announcements page, not in
    // the announcements channel, not on Home.
    await signIn(staff, "staff");
    await staff.goto("/announcements");
    await expect(staff.getByText(title)).toHaveCount(0);
    const channelId = sql(`
      select c.id from channel c
      join announcement a on a.channel_id = c.id
      where a.title = '${title}';
    `);
    expect(channelId).toMatch(/^[0-9a-f-]{36}$/);
    await staff.goto(`/channels/${channelId}`);
    await expect(staff.getByRole("heading").first()).toBeVisible();
    await expect(staff.getByText(body)).toHaveCount(0);
    await staff.goto("/");
    await expect(staff.getByText(body)).toHaveCount(0);

    // The publish time arrives and the job runs.
    sql(`update announcement set publish_at = now() - interval '1 minute' where title = '${title}';`);
    const run = await request.post("/api/jobs/scheduled-announcements", {
      headers: { "x-job-secret": JOB_SECRET },
    });
    expect(run.ok()).toBeTruthy();
    expect(
      sql(`select count(*) from message m join announcement a on a.message_id = m.id where a.title = '${title}';`),
    ).toBe("1");

    await staff.goto(`/channels/${channelId}`);
    await expect(staff.getByText(body)).toBeVisible();
    await staff.goto("/announcements");
    const card = staff.locator("article").filter({ hasText: title });
    await expect(card.getByText(body)).toBeVisible();
    await card.getByRole("button", { name: "Acknowledge" }).click();
    await expect(card.getByText("You acknowledged this")).toBeVisible();

    // The staff member was notified once the announcement went out.
    expect(
      sql(`
        select count(*) from notification n
        join announcement a on a.id = n.source_id
        join user_profile u on u.id = n.user_id
        where a.title = '${title}' and u.email = 'qa-staff@example.com';
      `),
    ).toBe("1");
  } finally {
    await adminContext.close();
    await staffContext.close();
  }
});
