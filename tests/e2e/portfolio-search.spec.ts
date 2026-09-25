import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

test("search finds the seven required types and hides a staff-only relationship from a volunteer", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const token = `SearchProof ${Date.now()}`;
  const [organizationId, ownerId] = sql(`
    select m.organization_id || '|' || m.user_id
    from organization_membership m
    where m.role = 'owner' and m.status = 'active'
    order by m.joined_at
    limit 1;
  `).split("|");

  const projectName = `${token} project`;
  const taskTitle = `${token} task`;
  const eventName = `${token} event`;
  const meetingTitle = `${token} meeting`;
  const agendaTitle = `${token} agenda`;
  const orgName = `${token} org`;
  const contactName = `${token} contact`;

  sql(`
    do $$
    declare
      v_org uuid := '${organizationId}';
      v_owner uuid := '${ownerId}';
      v_project uuid;
      v_meeting uuid;
      v_crm uuid;
    begin
      insert into public.project (organization_id, name, owner_id, created_by, stage)
      values (v_org, '${projectName}', v_owner, v_owner, 'planning')
      returning id into v_project;

      insert into public.task (organization_id, project_id, title, created_by)
      values (v_org, v_project, '${taskTitle}', v_owner);

      insert into public.event (organization_id, name, owner_id, created_by, starts_at)
      values (v_org, '${eventName}', v_owner, v_owner, now() + interval '3 days');

      insert into public.meeting (organization_id, title, organizer_id, starts_at)
      values (v_org, '${meetingTitle}', v_owner, now() + interval '2 days')
      returning id into v_meeting;

      insert into public.agenda_item (meeting_id, title, proposed_by)
      values (v_meeting, '${agendaTitle}', v_owner);

      insert into public.crm_organization (
        organization_id, name, category, owner_id, status, next_action_at
      ) values (
        v_org, '${orgName}', 'school', v_owner, 'active', current_date + 7
      ) returning id into v_crm;

      insert into public.crm_contact (
        organization_id, crm_organization_id, full_name, owner_id
      ) values (
        v_org, v_crm, '${contactName}', v_owner
      );
    end;
    $$;
  `);

  await page.goto("/projects");
  await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
  for (const heading of [
    "Project",
    "Program",
    "Owner",
    "Health",
    "Progress",
    "Next milestone",
    "Target",
    "Main blocker",
    "Last update",
  ]) {
    await expect(page.getByRole("columnheader", { name: heading })).toBeVisible();
  }

  await page.goto(`/search?q=${encodeURIComponent(token)}`);
  for (const name of [projectName, taskTitle, eventName, meetingTitle, agendaTitle, orgName, contactName]) {
    await expect(page.getByRole("link", { name })).toBeVisible({ timeout: 30_000 });
  }

  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(`/search?q=${encodeURIComponent(orgName)}`);
  await expect(page.getByRole("link", { name: orgName })).toHaveCount(0);
});
