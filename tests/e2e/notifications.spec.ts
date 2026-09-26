import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

const MAILPIT = "http://127.0.0.1:54324";
const JOB_SECRET = process.env.CRON_JOB_SECRET ?? "";

test.use({
  video: { mode: "on", size: { width: 1280, height: 720 } },
});

test("inbox filters, weekly modes, mutes, and one actionable email", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  await page.goto("/inbox");
  await expect(
    page.getByRole("link", { name: "Due dates", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Approvals", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Decisions", exact: true }),
  ).toBeVisible();

  await page.goto("/settings/notifications");
  await expect(page.getByLabel("Work assigned to me")).toBeVisible();
  await expect(page.getByLabel("Work assigned to me")).toContainText(
    "Weekly digest",
  );
  await expect(
    page.getByRole("heading", { name: "Muted projects" }),
  ).toBeVisible();

  const stamp = String(Date.now());
  const title = `Review the brief ${stamp}`;
  sql(`
    do $body$
    declare
      v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
      v_org uuid;
      v_project uuid;
    begin
      select organization_id into strict v_org
      from public.organization_membership where user_id = v_owner limit 1;
      insert into public.project (organization_id, name, created_by, owner_id)
      values (v_org, 'Mute ${stamp}', v_owner, v_owner)
      returning id into v_project;
      insert into public.notification_preference (user_id, category_modes, muted_project_ids)
      values (
        v_owner,
        '{"assignment":"immediate","mention":"weekly"}'::jsonb,
        array[v_project]
      )
      on conflict (user_id) do update
        set category_modes = excluded.category_modes,
            muted_project_ids = excluded.muted_project_ids;
      insert into public.notification (
        user_id, organization_id, category, title, body, link, urgency, dedupe_key,
        reason, context, owner_label, due_on
      ) values (
        v_owner, v_org, 'assignment', '${title}', 'Needs sign-off',
        '/my-work', 'normal', 'e2e-not-${stamp}:' || v_owner,
        'asked to review', 'Q3 brief', 'QA Owner', current_date
      );
      insert into public.notification (
        user_id, organization_id, category, title, link, urgency, dedupe_key, project_id
      ) values (
        v_owner, v_org, 'assignment', 'Muted project ${stamp}', '/my-work', 'normal',
        'e2e-mute-${stamp}:' || v_owner, v_project
      );
      insert into public.notification (
        user_id, organization_id, category, title, link, urgency, dedupe_key
      ) values (
        v_owner, v_org, 'mention', 'Weekly mention ${stamp}', '/inbox', 'normal',
        'e2e-week-${stamp}:' || v_owner
      );
    end;
    $body$;
  `);

  await page.goto("/inbox");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Muted project ${stamp}`, { exact: true }),
  ).toHaveCount(0);

  if (!JOB_SECRET) {
    throw new Error("CRON_JOB_SECRET is not set; the drain cannot be called.");
  }
  const drain = await request.post("/api/jobs/drain-notifications", {
    headers: {
      "x-job-secret": JOB_SECRET,
      Authorization: `Bearer ${JOB_SECRET}`,
    },
  });
  expect(drain.ok()).toBeTruthy();

  const muted = sql(`
    select status from email_delivery
    where dedupe_key like 'email:e2e-mute-${stamp}:%'
    limit 1;
  `);
  const weekly = sql(`
    select status from email_delivery
    where dedupe_key like 'email:e2e-week-${stamp}:%'
    limit 1;
  `);
  expect(muted).toBe("suppressed");
  expect(weekly).toBe("suppressed");

  const search = await request.get(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${title}"`)}&limit=5`,
  );
  expect(search.ok()).toBeTruthy();
  const found = (await search.json()) as { messages?: { ID: string }[] };
  // When nothing arrived, say why: the drain records each send failure on the
  // delivery row, and that is the only place the provider's reason survives.
  const delivery = sql(`
    select status || ' ' || coalesce(last_error, '')
    from email_delivery
    where dedupe_key like 'email:e2e-not-${stamp}:%'
    limit 1;
  `);
  expect(
    found.messages?.length ?? 0,
    `delivery: ${delivery || "no row"}`,
  ).toBeGreaterThan(0);
  const source = await request.get(
    `${MAILPIT}/api/v1/message/${found.messages![0].ID}`,
  );
  const mail = (await source.json()) as { Text?: string; HTML?: string };
  const body = `${mail.Text ?? ""}\n${mail.HTML ?? ""}`;
  expect(body).toContain("Action: asked to review");
  expect(body).toContain("Owner: QA Owner");
  expect(body).toMatch(/Due:/);
});
