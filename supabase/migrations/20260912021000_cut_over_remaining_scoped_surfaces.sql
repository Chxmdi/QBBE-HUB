-- Remaining scoped-access cutover: meetings, events, decisions, documents,
-- reports, CRM, activity and privileged export helpers. Unconverted outputs
-- fail closed rather than remaining organization-wide staff grants.

create or replace function app.can_read_meeting(p_meeting uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.meeting m
    join public.organization_membership mem
      on mem.organization_id = m.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where m.id = p_meeting
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or m.organizer_id = (select auth.uid())
        or exists (
          select 1 from public.meeting_attendee a
          where a.meeting_id = m.id and a.user_id = (select auth.uid())
        )
        or (
          m.project_id is not null
          and app.has_project_capability(m.project_id, 'read')
        )
        or (
          m.project_id is null and m.program_id is not null
          and app.has_program_capability(m.program_id, 'read')
        )
      )
  );
$$;

create or replace function app.can_manage_meeting(p_meeting uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.meeting m
    join public.organization_membership mem
      on mem.organization_id = m.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where m.id = p_meeting
      and not (
        mem.role in ('owner', 'admin')
        and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
      )
      and (
        (mem.role in ('owner', 'admin') and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2')
        or m.organizer_id = (select auth.uid())
        or (
          m.project_id is not null
          and app.has_project_capability(m.project_id, 'manage')
        )
        or (
          m.project_id is null and m.program_id is not null
          and app.has_program_capability(m.program_id, 'manage')
        )
      )
  );
$$;

create or replace function app.can_read_event(p_event uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.event e
    join public.organization_membership mem
      on mem.organization_id = e.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where e.id = p_event
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or e.owner_id = (select auth.uid())
        or exists (
          select 1 from public.event_assignment a
          where a.event_id = e.id and a.user_id = (select auth.uid())
        )
        or (
          e.project_id is not null
          and app.has_project_capability(e.project_id, 'read')
        )
        or (
          e.project_id is null and e.program_id is not null
          and app.has_program_capability(e.program_id, 'read')
        )
      )
  );
$$;

create or replace function app.can_manage_event(p_event uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.event e
    join public.organization_membership mem
      on mem.organization_id = e.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where e.id = p_event
      and not (
        mem.role in ('owner', 'admin')
        and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
      )
      and (
        (mem.role in ('owner', 'admin') and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2')
        or e.owner_id = (select auth.uid())
        or (
          e.project_id is not null
          and app.has_project_capability(e.project_id, 'manage')
        )
        or (
          e.project_id is null and e.program_id is not null
          and app.has_program_capability(e.program_id, 'manage')
        )
      )
  );
$$;

create or replace function app.can_access_crm(p_organization uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_org_staff(p_organization);
$$;

create or replace function app.can_read_document(p_document uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.document d
    join public.organization_membership mem
      on mem.organization_id = d.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where d.id = p_document
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or d.owner_id = (select auth.uid())
        or d.created_by = (select auth.uid())
        or (
          d.project_id is not null
          and app.has_project_capability(d.project_id, 'read')
        )
        or (
          d.program_id is not null
          and app.has_program_capability(d.program_id, 'read')
        )
        or (
          d.meeting_id is not null
          and app.can_read_meeting(d.meeting_id)
        )
        or (
          d.crm_organization_id is not null
          and app.can_access_crm(d.organization_id)
        )
        or (
          d.visibility = 'organization'
          and d.program_id is null
          and d.project_id is null
          and d.meeting_id is null
          and d.crm_organization_id is null
          and app.is_org_member(d.organization_id)
        )
      )
  );
$$;

create or replace function app.can_manage_document(p_document uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.document d
    where d.id = p_document
      and (
        app.is_org_admin(d.organization_id)
        or d.owner_id = (select auth.uid())
        or (
          d.project_id is not null
          and app.has_project_capability(d.project_id, 'manage')
        )
        or (
          d.program_id is not null
          and app.has_program_capability(d.program_id, 'manage')
        )
      )
  );
$$;

create or replace function app.can_read_report(p_report uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.report_instance r
    join public.organization_membership mem
      on mem.organization_id = r.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where r.id = p_report
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or (
          r.project_id is not null
          and app.has_project_capability(r.project_id, 'read')
        )
        or (
          r.program_id is not null
          and app.has_program_capability(r.program_id, 'read')
        )
      )
  );
$$;

create or replace function app.can_manage_report(p_report uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.report_instance r
    where r.id = p_report
      and (
        app.is_org_admin(r.organization_id)
        or (
          r.project_id is not null
          and app.has_project_capability(r.project_id, 'manage')
        )
        or (
          r.program_id is not null
          and app.has_program_capability(r.program_id, 'manage')
        )
      )
  );
$$;

create or replace function app.actor_has_program_capability(
  p_user uuid,
  p_program uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
    from public.program p
    join public.organization_membership m
      on m.organization_id = p.organization_id
     and m.user_id = p_user
     and m.status = 'active'
    where p.id = p_program
      and lower(coalesce(p_capability, '')) in (
        'read', 'manage', 'collaborate', 'review', 'approve', 'follow'
      )
      and (
        m.role in ('owner', 'admin', 'leadership_viewer')
        and lower(p_capability) = 'read'
        or m.role in ('owner', 'admin')
        and lower(p_capability) <> 'read'
        or p.lead_id = p_user
        or exists (
          select 1 from public.program_access_grant g
          where g.program_id = p.id
            and g.user_id = p_user
            and app.program_role_has_capability(g.role, p_capability)
        )
      )
  );
$$;

create or replace function app.actor_has_project_capability(
  p_user uuid,
  p_project uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
    from public.project p
    join public.organization_membership m
      on m.organization_id = p.organization_id
     and m.user_id = p_user
     and m.status = 'active'
    where p.id = p_project
      and lower(coalesce(p_capability, '')) in (
        'read', 'manage', 'collaborate', 'review', 'approve', 'follow'
      )
      and (
        m.role in ('owner', 'admin', 'leadership_viewer')
        and lower(p_capability) = 'read'
        or m.role in ('owner', 'admin')
        and lower(p_capability) <> 'read'
        or p.owner_id = p_user
        or exists (
          select 1 from public.project_access_grant g
          where g.project_id = p.id
            and g.user_id = p_user
            and app.project_role_has_capability(g.role, p_capability)
        )
        or (
          p.program_id is not null
          and app.actor_has_program_capability(p_user, p.program_id, p_capability)
        )
      )
  );
$$;

create or replace function public.actor_has_program_capability(
  p_user uuid, p_program uuid, p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.actor_has_program_capability(p_user, p_program, p_capability);
$$;

create or replace function public.actor_has_project_capability(
  p_user uuid, p_project uuid, p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.actor_has_project_capability(p_user, p_project, p_capability);
$$;

revoke all on function app.can_read_meeting(uuid), app.can_manage_meeting(uuid),
  app.can_read_event(uuid), app.can_manage_event(uuid),
  app.can_access_crm(uuid), app.can_read_document(uuid),
  app.can_manage_document(uuid), app.can_read_report(uuid),
  app.can_manage_report(uuid),
  app.actor_has_program_capability(uuid, uuid, text),
  app.actor_has_project_capability(uuid, uuid, text)
  from public, anon;
revoke all on function public.actor_has_program_capability(uuid, uuid, text),
  public.actor_has_project_capability(uuid, uuid, text)
  from public, anon;
grant execute on function app.can_read_meeting(uuid), app.can_manage_meeting(uuid),
  app.can_read_event(uuid), app.can_manage_event(uuid),
  app.can_access_crm(uuid), app.can_read_document(uuid),
  app.can_manage_document(uuid), app.can_read_report(uuid),
  app.can_manage_report(uuid)
  to authenticated, service_role;
grant execute on function app.actor_has_program_capability(uuid, uuid, text),
  app.actor_has_project_capability(uuid, uuid, text)
  to service_role;
grant execute on function public.actor_has_program_capability(uuid, uuid, text),
  public.actor_has_project_capability(uuid, uuid, text)
  to authenticated, service_role;

-- Meetings -----------------------------------------------------------------
drop policy if exists meeting_staff_write on public.meeting;
drop policy if exists meeting_read on public.meeting;
create policy meeting_read on public.meeting for select to authenticated
  using (app.can_read_meeting(id));
create policy meeting_scoped_insert on public.meeting for insert to authenticated
  with check (
    organizer_id = (select auth.uid())
    and (
      app.is_org_admin(organization_id)
      or (
        project_id is not null
        and app.has_project_capability(project_id, 'collaborate')
      )
      or (
        project_id is null and program_id is not null
        and app.has_program_capability(program_id, 'collaborate')
      )
    )
  );
create policy meeting_scoped_update on public.meeting for update to authenticated
  using (app.can_manage_meeting(id))
  with check (app.can_manage_meeting(id));
create policy meeting_scoped_delete on public.meeting for delete to authenticated
  using (app.can_manage_meeting(id));

drop policy if exists meeting_attendee_staff_write on public.meeting_attendee;
drop policy if exists meeting_attendee_read on public.meeting_attendee;
create policy meeting_attendee_read on public.meeting_attendee for select to authenticated
  using (app.can_read_meeting(meeting_id));
create policy meeting_attendee_scoped_write on public.meeting_attendee
  for all to authenticated
  using (app.can_manage_meeting(meeting_id))
  with check (app.can_manage_meeting(meeting_id));

drop policy if exists agenda_member_insert on public.agenda_item;
drop policy if exists agenda_staff_update on public.agenda_item;
drop policy if exists agenda_staff_delete on public.agenda_item;
drop policy if exists agenda_read on public.agenda_item;
create policy agenda_read on public.agenda_item for select to authenticated
  using (app.can_read_meeting(meeting_id));
create policy agenda_member_insert on public.agenda_item for insert to authenticated
  with check (app.can_read_meeting(meeting_id) and proposed_by = (select auth.uid()));
create policy agenda_staff_update on public.agenda_item for update to authenticated
  using (app.can_manage_meeting(meeting_id) or proposed_by = (select auth.uid()))
  with check (app.can_read_meeting(meeting_id));
create policy agenda_staff_delete on public.agenda_item for delete to authenticated
  using (app.can_manage_meeting(meeting_id));

drop policy if exists decision_staff_write on public.decision;
drop policy if exists decision_read on public.decision;
create policy decision_read on public.decision for select to authenticated
  using (
    (meeting_id is not null and app.can_read_meeting(meeting_id))
    or (
      project_id is not null
      and app.has_project_capability(project_id, 'read')
    )
    or (
      meeting_id is null and project_id is null
      and app.is_org_admin(organization_id)
    )
  );
create policy decision_scoped_write on public.decision for all to authenticated
  using (
    (meeting_id is not null and app.can_manage_meeting(meeting_id))
    or (
      project_id is not null
      and app.has_project_capability(project_id, 'manage')
    )
    or app.is_org_admin(organization_id)
  )
  with check (
    (meeting_id is not null and app.can_manage_meeting(meeting_id))
    or (
      project_id is not null
      and app.has_project_capability(project_id, 'manage')
    )
    or app.is_org_admin(organization_id)
  );

drop policy if exists meeting_action_staff_write on public.meeting_action;
drop policy if exists meeting_action_read on public.meeting_action;
create policy meeting_action_read on public.meeting_action for select to authenticated
  using (app.can_read_meeting(meeting_id));
create policy meeting_action_scoped_write on public.meeting_action
  for all to authenticated
  using (app.can_manage_meeting(meeting_id))
  with check (app.can_manage_meeting(meeting_id));

-- Events -------------------------------------------------------------------
drop policy if exists event_read on public.event;
drop policy if exists event_staff_write on public.event;
create policy event_read on public.event for select to authenticated
  using (app.can_read_event(id));
create policy event_scoped_insert on public.event for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      app.is_org_admin(organization_id)
      or (
        project_id is not null
        and app.has_project_capability(project_id, 'collaborate')
      )
      or (
        project_id is null and program_id is not null
        and app.has_program_capability(program_id, 'collaborate')
      )
    )
  );
create policy event_scoped_update on public.event for update to authenticated
  using (app.can_manage_event(id))
  with check (app.can_manage_event(id));
create policy event_scoped_delete on public.event for delete to authenticated
  using (app.can_manage_event(id));

drop policy if exists event_assignment_read on public.event_assignment;
drop policy if exists event_assignment_staff_write on public.event_assignment;
create policy event_assignment_read on public.event_assignment for select to authenticated
  using (app.can_read_event(event_id));
create policy event_assignment_scoped_write on public.event_assignment
  for all to authenticated
  using (app.can_manage_event(event_id))
  with check (app.can_manage_event(event_id));

-- Documents / storage ------------------------------------------------------
drop policy if exists document_read on public.document;
create policy document_read on public.document for select to authenticated
  using (app.can_read_document(id));
drop policy if exists document_member_insert on public.document;
create policy document_member_insert on public.document for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.is_org_member(organization_id)
    and (
      app.is_org_admin(organization_id)
      or (
        project_id is not null
        and app.has_project_capability(project_id, 'collaborate')
      )
      or (
        program_id is not null
        and app.has_program_capability(program_id, 'collaborate')
      )
      or (
        meeting_id is not null
        and app.can_manage_meeting(meeting_id)
      )
      or (
        crm_organization_id is not null
        and app.can_access_crm(organization_id)
      )
      or (
        program_id is null and project_id is null
        and meeting_id is null and crm_organization_id is null
        and visibility = 'organization'
      )
    )
  );
drop policy if exists document_update on public.document;
create policy document_update on public.document for update to authenticated
  using (app.can_manage_document(id))
  with check (app.can_manage_document(id));
drop policy if exists document_delete on public.document;
create policy document_delete on public.document for delete to authenticated
  using (app.can_manage_document(id) or owner_id = (select auth.uid()));

drop policy if exists "documents read for entitled members" on storage.objects;
create policy "documents read for entitled members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.document d
      where d.storage_path = storage.objects.name
        and app.can_read_document(d.id)
    )
  );

drop policy if exists "documents upload for active members" on storage.objects;
create policy "documents upload for entitled members" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and exists (
      select 1 from public.organization_membership m
      where m.user_id = (select auth.uid()) and m.status = 'active'
    )
  );

drop policy if exists "documents delete for staff" on storage.objects;
create policy "documents delete for entitled members" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.document d
      where d.storage_path = storage.objects.name
        and app.can_manage_document(d.id)
    )
  );

-- Reports ------------------------------------------------------------------
drop policy if exists report_read on public.report_instance;
drop policy if exists report_staff_read on public.report_instance;
drop policy if exists report_member_insert on public.report_instance;
drop policy if exists report_staff_insert on public.report_instance;
drop policy if exists report_admin_update on public.report_instance;
drop policy if exists report_version_insert on public.report_version;
drop policy if exists report_approval_read on public.report_approval;
create policy report_read on public.report_instance for select to authenticated
  using (app.can_read_report(id));
create policy report_scoped_insert on public.report_instance for insert to authenticated
  with check (
    generated_by = (select auth.uid())
    and (
      app.is_org_admin(organization_id)
      or (
        project_id is not null
        and app.has_project_capability(project_id, 'manage')
      )
      or (
        program_id is not null
        and app.has_program_capability(program_id, 'manage')
      )
    )
  );
create policy report_scoped_update on public.report_instance for update to authenticated
  using (app.can_manage_report(id))
  with check (app.can_manage_report(id));

drop policy if exists report_version_read on public.report_version;
create policy report_version_read on public.report_version for select to authenticated
  using (app.can_read_report(report_id));
create policy report_version_insert on public.report_version for insert to authenticated
  with check (
    generated_by = (select auth.uid())
    and app.can_manage_report(report_id)
  );
create policy report_approval_read on public.report_approval for select to authenticated
  using (
    exists (
      select 1 from public.report_version v
      where v.id = report_version_id and app.can_read_report(v.report_id)
    )
  );

-- CRM: explicit staff capability, not inherited program grants.
drop policy if exists crm_org_staff on public.crm_organization;
drop policy if exists crm_organization_staff_write on public.crm_organization;
drop policy if exists crm_organization_read on public.crm_organization;
create policy crm_organization_read on public.crm_organization for select to authenticated
  using (
    app.can_access_crm(organization_id)
    or owner_id = (select auth.uid())
  );
create policy crm_organization_write on public.crm_organization
  for all to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

drop policy if exists crm_contact_staff on public.crm_contact;
drop policy if exists crm_contact_staff_write on public.crm_contact;
drop policy if exists crm_contact_read on public.crm_contact;
create policy crm_contact_read on public.crm_contact for select to authenticated
  using (
    app.can_access_crm(organization_id)
    or owner_id = (select auth.uid())
  );
create policy crm_contact_write on public.crm_contact
  for all to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

drop policy if exists crm_interaction_staff on public.crm_interaction;
drop policy if exists crm_interaction_staff_write on public.crm_interaction;
create policy crm_interaction_read on public.crm_interaction for select to authenticated
  using (app.can_access_crm(organization_id) or owner_id = (select auth.uid()));
create policy crm_interaction_write on public.crm_interaction
  for all to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

drop policy if exists crm_follow_up_staff on public.crm_follow_up;
drop policy if exists crm_follow_up_staff_write on public.crm_follow_up;
create policy crm_follow_up_read on public.crm_follow_up for select to authenticated
  using (app.can_access_crm(organization_id) or owner_id = (select auth.uid()));
create policy crm_follow_up_write on public.crm_follow_up
  for all to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

drop policy if exists opportunity_staff on public.opportunity;
drop policy if exists opportunity_staff_write on public.opportunity;
create policy opportunity_read on public.opportunity for select to authenticated
  using (app.can_access_crm(organization_id) or owner_id = (select auth.uid()));
create policy opportunity_write on public.opportunity
  for all to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

-- Activity is visible only when the referenced work is.
drop policy if exists activity_read on public.activity_event;
create policy activity_read on public.activity_event for select to authenticated
  using (
    (
      project_id is not null
      and app.has_project_capability(project_id, 'read')
    )
    or (
      project_id is null and program_id is not null
      and app.has_program_capability(program_id, 'read')
    )
    or (
      project_id is null and program_id is null
      and app.is_org_member(organization_id)
    )
  );

-- Exports: organization-wide dumps stay admin-only; scoped kinds remain staff.
drop policy if exists export_job_request on public.export_job;
create policy export_job_request on public.export_job for insert to authenticated
with check (
  requested_by = auth.uid()
  and status = 'queued' and storage_path is null
  and started_at is null and completed_at is null
  and download_count = 0 and downloaded_at is null
  and (
    (app.is_org_admin(organization_id) and kind in ('organization_data', 'person_data'))
    or (app.is_org_staff(organization_id) and kind in ('crm_contacts', 'task_history', 'report_bundle'))
  )
  and (
    (kind <> 'person_data' and subject_user_id is null)
    or (kind = 'person_data' and exists (
      select 1 from public.organization_membership m
      where m.organization_id = export_job.organization_id
        and m.user_id = export_job.subject_user_id
    ))
  )
);

comment on function app.can_read_meeting(uuid) is
  'Meeting visibility follows organizer, attendee and parent program/project grants.';
