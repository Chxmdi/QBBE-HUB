import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V1-9: meetings as objects, behind the `wos_meetings_v2` switch.
 *
 * The organizer captures items through notes (`/task` lines) and the capture
 * form, attaches a recording, and applies the end-of-meeting review: the task
 * becomes a real task linked to the meeting, the decision a decision record,
 * the question stays on the meeting. Someone who cannot read the meeting gets
 * a 404, and so does everyone while the switch is off.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

function setSwitch(on: boolean) {
  sql(`update public.feature_flag set enabled = ${on} where key = 'wos_meetings_v2';`);
}

test.afterAll(() => setSwitch(false));

test("the organizer captures during a meeting and the review turns it into real work", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const title = `Object meeting ${stamp}`;
  const meetingId = sql(`
    insert into public.meeting (organization_id, title, organizer_id, starts_at)
    select m.organization_id, '${title}', u.id, now()
    from auth.users u join public.organization_membership m on m.user_id = u.id
    where u.email = 'qa-staff@example.com'
    returning id;
  `);
  sql(`insert into public.agenda_item (meeting_id, title, time_box_minutes) values ('${meetingId}', 'Venue', 15);`);

  // Off by default: the page does not exist.
  setSwitch(false);
  await signIn(page, "staff");
  const off = await page.goto(`/meetings-v2/${meetingId}`);
  expect(off?.status()).toBe(404);

  setSwitch(true);
  await page.goto(`/meetings-v2/${meetingId}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(page.getByText("Venue")).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);

  // Notes: slash lines become captures, and the lines are rewritten.
  const notes = page.getByLabel("Meeting notes");
  await notes.fill(`Discussed the venue.\n/task Book the hall ${stamp}\n/decision Hold it indoors ${stamp}`);
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 item(s) captured" })).toBeVisible({ timeout: 30_000 });
  await expect(notes).toHaveValue(new RegExp(`Task: Book the hall ${stamp}`));

  // The capture form, driven from the keyboard.
  await page.getByLabel("Type", { exact: true }).selectOption("question");
  const body = page.getByLabel("What was said");
  await body.focus();
  await page.keyboard.type(`Who pays for parking ${stamp}?`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Captured." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Who pays for parking ${stamp}?`).last()).toBeVisible();

  // A recording is a file attachment, nothing more.
  await page.getByLabel("Recording file").setInputFiles({
    name: `recording-${stamp}.mp3`,
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3 fake audio for the test"),
  });
  await page.getByRole("button", { name: "Attach recording" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording attached." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`recording-${stamp}.mp3`)).toBeVisible();

  // The end-of-meeting review.
  await page.getByRole("link", { name: /End-of-meeting review/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "End-of-meeting review" })).toBeVisible();
  await expect(page.getByRole("group", { name: `Outcome for “Book the hall ${stamp}”` })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  await page.getByRole("button", { name: "Apply review" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review applied: 2 created, 1 kept, 0 dismissed." })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Everything captured has been reviewed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Task created" })).toBeVisible();

  expect(
    sql(`select count(*) from public.task t join public.meeting_action a on a.task_id = t.id
         where a.meeting_id = '${meetingId}' and t.title = 'Book the hall ${stamp}';`),
  ).toBe("1");
  expect(
    sql(`select count(*) from public.decision where meeting_id = '${meetingId}' and title = 'Hold it indoors ${stamp}';`),
  ).toBe("1");
  expect(
    sql(`select count(*) from public.meeting_capture where meeting_id = '${meetingId}' and status = 'approved';`),
  ).toBe("3");

  // French.
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Bilan de fin de réunion" })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });

  // Someone who cannot read the meeting does not see it, switch or not.
  await signOut(page);
  await signIn(page, "volunteer");
  const denied = await page.goto(`/meetings-v2/${meetingId}`);
  expect(denied?.status()).toBe(404);
});
