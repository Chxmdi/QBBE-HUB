import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { expectAccessible, qaIds, setLensesSwitch } from "./insight";

/**
 * Process analytics (V3-3): time in each status and the bottleneck from task
 * status changes, turnaround per type, and approval wait times. Hidden until
 * the lenses switch is on.
 */
test("process analytics shows time in status, turnaround and approval waits", async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `Flow ${Date.now()}`;
  const { ownerId, orgId } = qaIds();
  const change = (task: string, from: string, to: string, daysAgo: number) =>
    sql(
      `insert into activity_event (organization_id, actor_id, verb, source_type, source_id, summary, metadata, created_at)
       values ('${orgId}', '${ownerId}', 'updated', 'task', '${task}', '${marker} change',
         jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('field', 'status', 'from', '${from}', 'to', '${to}'))),
         now() - interval '${daysAgo} days')`,
    );
  const task = (title: string, status: string, createdDaysAgo: number) =>
    sql(
      `insert into task (organization_id, title, created_by, status, blocked_reason, created_at)
       values ('${orgId}', '${marker} ${title}', '${ownerId}', '${status}',
         ${status === "blocked" ? "'Waiting on the venue'" : "null"}, now() - interval '${createdDaysAgo} days') returning id`,
    );
  const before = setLensesSwitch(false);
  try {
    // Two tasks that each sat in Blocked for a long time: Blocked is the bottleneck.
    const first = task("first", "in_progress", 20);
    change(first, "not_started", "blocked", 19);
    change(first, "blocked", "in_progress", 1);
    const second = task("second", "blocked", 15);
    change(second, "not_started", "blocked", 14);
    // An approval submitted three days ago, still waiting.
    const item = sql(
      `set session_replication_role = replica;
       insert into approval_item (organization_id, subject_type, title, requested_by, status, current_step, created_at)
       values ('${orgId}', 'other', '${marker} approval', '${ownerId}', 'pending', 1, now() - interval '3 days') returning id;`,
    );
    sql(
      `set session_replication_role = replica;
       insert into approval_event (item_id, organization_id, actor_id, kind, created_at)
       values ('${item}', '${orgId}', '${ownerId}', 'submitted', now() - interval '3 days');`,
    );

    await signIn(page, "owner");
    await page.goto("/insight/process");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();

    setLensesSwitch(true);
    await page.goto("/insight/process");
    await expect(page.getByRole("heading", { name: "How work flows", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "Last 90 days" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("status")).toContainText(/Biggest bottleneck: Blocked\. Tasks wait there \d+(\.\d)? d on average/);
    const blocked = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Blocked", exact: true }) });
    await expect(blocked).toBeVisible();

    const turnaround = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Approvals", exact: true }) });
    await expect(turnaround).toBeVisible();
    const waiting = page.getByRole("row").filter({ has: page.getByRole("link", { name: `${marker} approval` }) });
    await expect(waiting.getByRole("cell")).toHaveText(/^(7[0-9]|3(\.\d)?) (h|d)$/);
    await expectAccessible(page);

    // A shorter period, from the keyboard.
    const thirty = page.getByRole("link", { name: "Last 30 days" });
    await thirty.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/days=30/);
    await expect(page.getByRole("link", { name: `${marker} approval` })).toBeVisible();

    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Circulation du travail", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Principal goulot d’étranglement");
  } finally {
    setLensesSwitch(before);
    sql(`delete from approval_item where title = '${marker} approval'`);
    sql(`delete from activity_event where summary = '${marker} change'`);
    sql(`delete from task where title like '${marker}%'`);
  }
});
