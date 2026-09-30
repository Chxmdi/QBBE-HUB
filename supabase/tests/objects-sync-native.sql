-- Workspace OS M1c: meetings, decisions, risks, outcome metrics, teams,
-- events, contacts, documents and people each have exactly one object, and
-- the counts stay equal through inserts and deletes
-- (20261101010300_object_sync_other_native_types.sql). Run after
-- qa-users.sql and rls.sql. All mutations are rolled back.
begin;

-- Rows without an object of the right type and organization, plus objects of
-- that type without a row.
create or replace function tests.objects_native_gaps(p_table text, p_type text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_gaps integer;
begin
  execute format($q$
    select
      (select count(*) from public.%1$I n
       where not exists (
         select 1 from public.object o join public.object_type t on t.id = o.type_id
         where o.id = n.id and t.key = %2$L and o.organization_id = n.organization_id))
      + (select count(*) from public.object o join public.object_type t on t.id = o.type_id
         where t.key = %2$L and not exists (select 1 from public.%1$I n where n.id = o.id))
  $q$, p_table, p_type) into v_gaps;
  return v_gaps;
end;
$$;

-- People: one object per membership whose profile exists.
create or replace function tests.objects_person_gaps()
returns integer
language sql
set search_path = ''
as $$
  select
    (select count(*)::integer from public.organization_membership m
     join public.user_profile u on u.id = m.user_id
     where not exists (
       select 1 from public.object o join public.object_type t on t.id = o.type_id
       where o.id = m.user_id and t.key = 'person' and o.organization_id = m.organization_id))
    + (select count(*)::integer from public.object o join public.object_type t on t.id = o.type_id
       where t.key = 'person' and not exists (
         select 1 from public.organization_membership m
         where m.user_id = o.id and m.organization_id = o.organization_id));
$$;

create or replace function tests.objects_all_native_gaps()
returns integer
language sql
set search_path = ''
as $$
  select tests.objects_native_gaps('meeting', 'meeting')
    + tests.objects_native_gaps('decision', 'decision')
    + tests.objects_native_gaps('risk', 'risk')
    + tests.objects_native_gaps('outcome_metric', 'outcome_metric')
    + tests.objects_native_gaps('team', 'team')
    + tests.objects_native_gaps('event', 'event')
    + tests.objects_native_gaps('crm_contact', 'contact')
    + tests.objects_native_gaps('document', 'document')
    + tests.objects_person_gaps();
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_meeting uuid;
  v_decision uuid;
  v_decision_no_meeting uuid;
  v_risk uuid;
  v_metric uuid;
  v_team uuid;
  v_event uuid;
  v_contact uuid;
  v_document uuid;
  v_objects_before bigint;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  perform tests.ok(tests.objects_native_gaps('meeting', 'meeting') = 0, 'existing meetings each have one object');
  perform tests.ok(tests.objects_native_gaps('decision', 'decision') = 0, 'existing decisions each have one object');
  perform tests.ok(tests.objects_native_gaps('risk', 'risk') = 0, 'existing risks each have one object');
  perform tests.ok(tests.objects_native_gaps('outcome_metric', 'outcome_metric') = 0, 'existing outcome metrics each have one object');
  perform tests.ok(tests.objects_native_gaps('team', 'team') = 0, 'existing teams each have one object');
  perform tests.ok(tests.objects_native_gaps('event', 'event') = 0, 'existing events each have one object');
  perform tests.ok(tests.objects_native_gaps('crm_contact', 'contact') = 0, 'existing contacts each have one object');
  perform tests.ok(tests.objects_native_gaps('document', 'document') = 0, 'existing documents each have one object');
  perform tests.ok(tests.objects_person_gaps() = 0, 'every member with a profile has one person object');

  select count(*) into v_objects_before from public.object;

  -- Inserts.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Native sync', 'native-sync-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Native sync project', v_owner, v_owner)
  returning id into v_project;

  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at)
  values (v_org, v_project, 'Board meeting', v_staff, now() + interval '1 day')
  returning id into v_meeting;
  insert into public.decision (organization_id, project_id, meeting_id, title, decided_by)
  values (v_org, v_project, v_meeting, 'Approve the budget', v_owner)
  returning id into v_decision;
  insert into public.decision (organization_id, project_id, title)
  values (v_org, v_project, 'Decided outside a meeting')
  returning id into v_decision_no_meeting;
  insert into public.risk (organization_id, project_id, title, owner_id, created_by)
  values (v_org, v_project, 'Venue falls through', v_staff, v_owner)
  returning id into v_risk;
  insert into public.outcome_metric (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Families served', v_owner, v_owner)
  returning id into v_metric;
  insert into public.team (organization_id, name, owner_id)
  values (v_org, 'Kitchen crew', v_staff)
  returning id into v_team;
  insert into public.event (organization_id, project_id, name, owner_id, starts_at, created_by)
  values (v_org, v_project, 'Harvest dinner', v_staff, now() + interval '7 days', v_owner)
  returning id into v_event;
  insert into public.crm_contact (organization_id, full_name, owner_id)
  values (v_org, 'Marie Tremblay', v_staff)
  returning id into v_contact;
  insert into public.document (organization_id, project_id, title, kind, url, owner_id, created_by)
  values (v_org, v_project, 'Budget sheet', 'link', 'https://drive.google.com/file/d/budget/view', v_owner, v_owner)
  returning id into v_document;

  perform tests.ok(tests.objects_all_native_gaps() = 0, 'counts stay equal after inserting one of each type');
  perform tests.ok(
    (select count(*) from public.object) = v_objects_before + 10,
    'ten records inserted, ten objects added (a program has none)'
  );

  -- What each object holds.
  perform tests.ok(
    exists (select 1 from public.object where id = v_meeting and title = 'Board meeting'
      and owner_id = v_staff and parent_object_id = v_project),
    'a meeting''s object: title, organizer as owner, project as parent'
  );
  perform tests.ok(
    (select parent_object_id from public.object where id = v_decision) = v_meeting
      and (select parent_object_id from public.object where id = v_decision_no_meeting) = v_project,
    'a decision sits in its meeting, else in its project'
  );
  perform tests.ok(
    exists (select 1 from public.object where id = v_document and parent_object_id = v_project
      and title = 'Budget sheet'),
    'a document sits in its project'
  );
  perform tests.ok(
    exists (select 1 from public.object where id = v_contact and title = 'Marie Tremblay'
      and owner_id = v_staff),
    'a contact''s object has the name and owner only'
  );

  -- Archiving by status or date.
  update public.meeting set status = 'cancelled' where id = v_meeting;
  perform tests.ok((select archived_at is not null from public.object where id = v_meeting),
    'a cancelled meeting''s object is archived');
  update public.meeting set status = 'scheduled' where id = v_meeting;
  perform tests.ok((select archived_at is null from public.object where id = v_meeting),
    'rescheduling restores it');
  update public.risk set closed_at = now(), status = 'closed', mitigation = 'Booked another venue' where id = v_risk;
  perform tests.ok((select archived_at is not null from public.object where id = v_risk),
    'a closed risk''s object is archived');
  update public.outcome_metric set retired_at = now() where id = v_metric;
  perform tests.ok((select archived_at is not null from public.object where id = v_metric),
    'a retired metric''s object is archived');
  update public.crm_contact set status = 'inactive' where id = v_contact;
  perform tests.ok((select archived_at is not null from public.object where id = v_contact),
    'an inactive contact''s object is archived');
  update public.event set status = 'cancelled' where id = v_event;
  perform tests.ok((select archived_at is not null from public.object where id = v_event),
    'a cancelled event''s object is archived');
  update public.team set name = 'Kitchen team' where id = v_team;
  perform tests.ok((select title from public.object where id = v_team) = 'Kitchen team',
    'renaming a team renames its object');

  -- People.
  update public.user_profile set full_name = 'QA Volunteer Renamed' where id = v_volunteer;
  perform tests.ok(
    (select title from public.object where id = v_volunteer) = 'QA Volunteer Renamed',
    'renaming a person renames their object'
  );
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.ok((select archived_at is not null from public.object where id = v_volunteer),
    'a deactivated member''s person object is archived');
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.ok((select archived_at is null from public.object where id = v_volunteer),
    'reactivating restores it');

  -- Deletes.
  delete from public.decision where id in (v_decision, v_decision_no_meeting);
  delete from public.document where id = v_document;
  delete from public.meeting where id = v_meeting;
  delete from public.risk where id = v_risk;
  delete from public.outcome_metric where id = v_metric;
  delete from public.team where id = v_team;
  delete from public.event where id = v_event;
  delete from public.crm_contact where id = v_contact;
  perform tests.ok(
    not exists (select 1 from public.object where id in (
      v_meeting, v_decision, v_decision_no_meeting, v_risk, v_metric, v_team, v_event, v_contact, v_document)),
    'deleting each record deletes its object'
  );
  delete from public.organization_membership where organization_id = v_org and user_id = v_volunteer;
  perform tests.ok(not exists (select 1 from public.object where id = v_volunteer),
    'removing a membership removes the person object');
  perform tests.ok(tests.objects_all_native_gaps() = 0, 'counts stay equal after deletes');
end;
$$;

rollback;
