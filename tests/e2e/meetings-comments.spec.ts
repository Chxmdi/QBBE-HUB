import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { clickWhenInteractive } from "./interactive";
import { sql } from "./db";

/**
 * Epic #13 completion (#33, #34): a recurring meeting whose agenda is edited,
 * combined and carried forward, and a comment thread with a reply, an edit, a
 * resolution and a deletion that leaves its marker.
 */

test("a recurring meeting's agenda is edited, combined and carried forward", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const suffix = randomUUID().slice(0, 8);
  const title = `Series planning ${suffix}`;

  await signIn(page, "owner");
  await page.goto("/meetings");
  await clickWhenInteractive(page.getByRole("button", { name: "New meeting" }));
  const schedule = page.getByRole("dialog", { name: "Schedule meeting" });
  await schedule.getByLabel("Title").fill(title);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await schedule.getByLabel("Starts").fill(`${tomorrow}T10:00`);
  await schedule.getByLabel(/^Repeats/).selectOption("weekly");
  await schedule.getByLabel(/^Occurrences/).fill("3");
  await schedule.getByRole("button", { name: "Schedule" }).click();
  await expect(schedule).toBeHidden({ timeout: 30_000 });

  // Three occurrences share one series.
  expect(
    sql(
      `select count(distinct series_id) || ':' || count(*) from meeting where title = '${title}'`,
    ),
  ).toBe("1:3");
  const [firstId, secondId] = sql(
    `select id from meeting where title = '${title}' order by starts_at`,
  ).split("\n");

  await page.goto(`/meetings/${firstId}`);
  await expect(
    page.getByText("Occurrence 1 of 3.", { exact: false }),
  ).toBeVisible();

  async function addItem(name: string, outcome?: string) {
    await page.getByRole("button", { name: "Add item" }).click();
    const dialog = page.getByRole("dialog", { name: "Add agenda item" });
    await dialog.getByLabel("Item").fill(name);
    if (outcome) await dialog.getByLabel(/^Desired outcome/).fill(outcome);
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  }
  await addItem(`Budget ${suffix}`, "Agree the ceiling");
  await addItem(`Venue ${suffix}`);
  await addItem(`Catering ${suffix}`);
  const agenda = page.getByRole("region", { name: "Agenda" });
  await expect(agenda.getByText("Outcome: Agree the ceiling")).toBeVisible();

  // Edit.
  const budget = agenda
    .getByRole("listitem")
    .filter({ hasText: `Budget ${suffix}` });
  await budget.getByRole("button", { name: "Edit item" }).click();
  const edit = page.getByRole("dialog", { name: "Edit agenda item" });
  await edit.getByLabel("Item").fill(`Budget review ${suffix}`);
  await edit.getByRole("button", { name: "Save item" }).click();
  await expect(edit).toBeHidden({ timeout: 30_000 });
  await expect(
    agenda.getByText(`Budget review ${suffix}`, { exact: true }),
  ).toBeVisible();

  // Combine the venue into the budget review.
  await page.getByRole("button", { name: `Combine "Venue ${suffix}"` }).click();
  await agenda
    .getByLabel("Combine into")
    .selectOption({ label: `Budget review ${suffix}` });
  await agenda.getByRole("button", { name: "Combine", exact: true }).click();
  await expect(
    agenda.getByText(`Combined into: Budget review ${suffix}`),
  ).toBeVisible({
    timeout: 30_000,
  });

  // Carry catering to the next occurrence.
  await page
    .getByRole("button", { name: `Carry "Catering ${suffix}" forward` })
    .click();
  await agenda.getByLabel("Carry to").selectOption({ index: 1 });
  await agenda
    .getByRole("button", { name: "Carry forward", exact: true })
    .click();
  await expect(
    agenda
      .getByRole("listitem")
      .filter({ hasText: `Catering ${suffix}` })
      .getByText("Deferred"),
  ).toBeVisible({ timeout: 30_000 });

  await page.goto(`/meetings/${secondId}`);
  const next = page.getByRole("region", { name: "Agenda" });
  await expect(
    next.getByText(`Catering ${suffix}`, { exact: true }),
  ).toBeVisible();
  await expect(
    next.getByText("Carried forward from an earlier meeting"),
  ).toBeVisible();

  // Remove it again from the later meeting.
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: `Remove "Catering ${suffix}"` })
    .click();
  await expect(
    next.getByText(`Catering ${suffix}`, { exact: true }),
  ).toHaveCount(0, {
    timeout: 30_000,
  });
});

test("a comment thread takes a reply, an edit and a resolution, and a deletion leaves a marker", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const body = `Who is bringing the figures? ${suffix}`;
  const reply = `I will, by Thursday ${suffix}`;
  const projectId = sql(
    `select id from project where name = 'Fall Community Workshop Series'`,
  );

  await signIn(page, "owner");
  await page.goto(`/projects/${projectId}`);
  await page.getByPlaceholder("Add a comment").fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();
  const thread = page.getByRole("listitem").filter({ hasText: body }).first();
  await expect(thread).toBeVisible({ timeout: 30_000 });

  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await thread.getByPlaceholder("Write a reply").fill(reply);
  await thread.getByRole("button", { name: "Post reply" }).click();
  const replies = thread.getByRole("list", { name: "Replies" });
  await expect(replies.getByText(reply)).toBeVisible({ timeout: 30_000 });

  await thread
    .getByRole("button", { name: "Edit", exact: true })
    .first()
    .click();
  await thread.getByLabel("Edit comment").fill(`${body} (revised)`);
  await thread.getByRole("button", { name: "Save comment" }).click();
  await expect(thread.getByText(`${body} (revised)`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(thread.getByText(/· edited/).first()).toBeVisible();

  await thread.getByRole("button", { name: "Resolve" }).click();
  await expect(thread.getByText(/· resolved/).first()).toBeVisible({
    timeout: 30_000,
  });

  page.once("dialog", (dialog) => void dialog.accept());
  await replies.getByRole("button", { name: "Delete" }).click();
  await expect(replies.getByText(/^Comment deleted/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(replies.getByText(reply)).toHaveCount(0);

  // The row and an audit record survive the deletion.
  expect(
    sql(
      `select count(*) from record_comment c join audit_event a on a.object_id = c.id
       where c.body = '${reply}' and c.deleted_at is not null and a.event_type = 'comment.deletion'`,
    ),
  ).toBe("1");
});
