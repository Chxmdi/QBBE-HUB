import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

test("a volunteer cannot download a report CSV or PDF they cannot read", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const [organizationId, ownerId] = sql(`
    select m.organization_id || '|' || m.user_id
    from organization_membership m
    where m.role = 'owner' and m.status = 'active'
    order by m.joined_at
    limit 1;
  `).split("|");

  const reportId = sql(`
    insert into public.report_instance (
      organization_id, report_type, title, generated_by, snapshot
    ) values (
      '${organizationId}',
      'project',
      'Export denial ${Date.now()}',
      '${ownerId}',
      '{"project":{"name":"Hidden","outcome":"x","health":"on_track"},"progress":{"percent":0,"completed":0,"total":0}}'::jsonb
    )
    returning id::text;
  `);
  expect(reportId).toBeTruthy();

  await page.goto(`/reports/${reportId}`);
  await expect(page.getByRole("heading", { name: "Outcome" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Next steps" })).toBeVisible();

  await signOut(page);
  await signIn(page, "volunteer");
  const csv = await page.request.get(`/reports/${reportId}/csv`);
  expect(csv.status()).toBe(404);
  const pdf = await page.request.get(`/reports/${reportId}/pdf`);
  expect(pdf.status()).toBe(404);
});
