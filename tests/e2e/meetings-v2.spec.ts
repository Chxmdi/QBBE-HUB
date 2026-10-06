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
 * the not-found page, and so does everyone while the switch is off.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

/** The workspace not-found page; streamed pages answer 200, so the text is the check. */
const NOT_FOUND = "Not found — or not yours to see";

function setSwitch(on: boolean) {
  sql(`update public.feature_flag set enabled = ${on} where key = any (array['wos_meetings_v2']);`);
}

// Proves the placeholder notes (wos_editor off) and the off state of
// wos_meetings_v2, so it runs in the switches-off rows only; the block-editor
// meeting path is wos-mvp-exit.spec.ts in the switches-on rows.
test.afterAll(() => setSwitch(false));

test("the organizer captures during a meeting and the review turns it into real work [switch off]", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const title = `Object meeting ${stamp}`;
  // A project the staff member manages, as real meetings have: tasks from the
  // review are created in the meeting's project.
  const meetingId = sql(`
    with who as (
      select u.id as user_id, m.organization_id
      from auth.users u join public.organization_membership m on m.user_id = u.id
      where u.email = 'qa-staff@example.com'
    ), prog as (
      insert into public.program (organization_id, name, slug, created_by)
      select organization_id, 'Meetings v2 ${stamp}', 'mv2-${stamp}', user_id from who
      returning id, organization_id
    ), proj as (
      insert into public.project (organization_id, program_id, name, owner_id, created_by)
      select prog.organization_id, prog.id, 'Meetings v2 ${stamp}', who.user_id, who.user_id from prog, who
      returning id, organization_id, program_id
    ), grant_row as (
      insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
      select proj.organization_id, proj.id, who.user_id, 'project_manager', 'direct', who.user_id from proj, who
    )
    insert into public.meeting (organization_id, program_id, project_id, title, organizer_id, starts_at)
    select proj.organization_id, proj.program_id, proj.id, '${title}', who.user_id, now() from proj, who
    returning id;
  `);
  sql(`insert into public.agenda_item (meeting_id, title, time_box_minutes) values ('${meetingId}', 'Venue', 15);`);

  // Off by default: the page does not exist.
  setSwitch(false);
  await signIn(page, "staff");
  await page.goto(`/meetings-v2/${meetingId}`);
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();

  setSwitch(true);
  await page.goto(`/meetings-v2/${meetingId}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(page.getByLabel("Agenda", { exact: true }).getByText("Venue")).toBeVisible();
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
  await page.goto(`/meetings-v2/${meetingId}`);
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});
