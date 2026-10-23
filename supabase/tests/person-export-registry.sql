-- The personal-data export covers every table that names a person, and the
-- contact export every table that names a CRM contact. Run after
-- qa-users.sql and rls.sql. Rolled back.
--
-- A new table with a column referencing auth.users or user_profile, an email
-- column, or a column referencing crm_contact fails this file until it is
-- added to app.person_data_registry: exported, or excluded with a reason.
begin;

do $$
declare
  v_missing text;
  v_stale text;
begin
  select string_agg(c.table_name || '.' || c.column_name || ' (' || c.kind || ')', ', ' order by c.table_name, c.column_name)
    into v_missing
  from app.person_reference_columns() c
  where not exists (
    select 1 from app.person_data_registry r
    where r.subject = case when c.kind = 'contact' then 'contact' else 'person' end
      and r.table_name = c.table_name and r.column_name = c.column_name);
  perform tests.ok(v_missing is null,
    'person export registry: every column naming a person, an email or a contact is exported or excluded with a reason; missing: '
    || coalesce(v_missing, 'none'));

  select string_agg(r.subject || ':' || r.table_name || '.' || r.column_name, ', ') into v_stale
  from app.person_data_registry r
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name);
  perform tests.ok(v_stale is null, 'person export registry: no entry names a column that does not exist; stale: ' || coalesce(v_stale, 'none'));

  perform tests.ok(not exists (
    select 1 from app.person_data_registry
    where excluded_reason is not null and length(trim(excluded_reason)) < 20),
    'person export registry: every exclusion gives a real reason');
  perform tests.ok(not exists (
    select 1 from app.person_data_registry r
    where r.scope = 'parent' and not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = r.parent_table and c.column_name = 'organization_id')),
    'person export registry: every parent used for scoping carries the organization');
  perform tests.ok(not exists (
    select 1 from app.person_data_registry r
    where r.scope = 'organization' and not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = 'organization_id')),
    'person export registry: every organization-scoped table has an organization');
end;
$$;

-- What the exports contain, scoped to the organization.
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_other_org uuid;
  v_task uuid;
  v_other_task uuid;
  v_invitation uuid;
  v_contact uuid;
  v_other_contact uuid;
  v_export jsonb;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  insert into organization (name, slug) values ('Zzexport Other Org', 'zzexport-other-' || txid_current())
    returning id into v_other_org;

  insert into task (organization_id, title, created_by, assignee_id) values (v_org, 'Zzexport own task', v_owner, v_staff)
    returning id into v_task;
  -- Another organization's task naming the person, as a database owner could leave it.
  insert into task (organization_id, title, created_by) values (v_other_org, 'Zzexport other task', v_staff)
    returning id into v_other_task;
  insert into task_assignment (task_id, user_id, role) values (v_task, v_staff, 'contributor');
  insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
    select v_org, email, 'staff', v_owner, now() + interval '1 day' from user_profile where id = v_staff
    returning id into v_invitation;

  v_export := public.person_data_export(v_org, v_staff);
  perform tests.ok(v_export -> 'task.assignee_id' @> jsonb_build_array(jsonb_build_object('id', v_task)),
    'person export: a task assigned to the person is in it');
  perform tests.ok(not (v_export::text like '%' || v_other_task || '%'),
    'person export: nothing from another organization is in it');
  perform tests.ok(v_export -> 'task_assignment.user_id' @> jsonb_build_array(jsonb_build_object('task_id', v_task)),
    'person export: a table without an organization of its own is scoped through its parent');
  perform tests.ok(v_export -> 'invitation.email' @> jsonb_build_array(jsonb_build_object('id', v_invitation)),
    'person export: rows naming the person by email address are in it');
  insert into audit_event (organization_id, actor_id, actor_type, event_type, action, object_type)
    values (v_org, v_staff, 'user', 'zzexport', 'probe', 'task');
  v_export := public.person_data_export(v_org, v_staff);
  perform tests.ok(v_export -> 'audit_event.actor_id' @> '[{"event_type": "zzexport"}]'::jsonb,
    'person export: what the audit trail records the person doing is in it');
  perform tests.ok(v_export -> 'user_profile.id' -> 0 ->> 'email' is not null,
    'person export: the profile is in it');
  perform tests.ok(not (v_export::text ~ 'token_hash|encrypted|secret'),
    'person export: no token or secret column is copied');

  begin
    perform public.person_data_export(v_other_org, v_staff);
    perform tests.ok(false, 'person export: a person outside the organization is refused');
  exception when sqlstate '22023' then
    perform tests.ok(true, 'person export: a person outside the organization is refused');
  end;

  insert into crm_contact (organization_id, full_name, email) values (v_org, 'Zzexport Donor', 'zzexport-donor@example.com')
    returning id into v_contact;
  insert into crm_contact (organization_id, full_name, email) values (v_other_org, 'Zzexport Elsewhere', 'zzexport-donor@example.com')
    returning id into v_other_contact;
  insert into crm_interaction (organization_id, contact_id, interaction_type, occurred_at, summary, owner_id)
    values (v_org, v_contact, 'call', now(), 'Zzexport talked about the spring gift', v_owner);
  insert into crm_interaction (organization_id, contact_id, interaction_type, occurred_at, summary, owner_id)
    values (v_other_org, v_other_contact, 'call', now(), 'Zzexport other organization call', v_owner);

  -- A staff member's private captured email from the contact, and a sensitive note.
  insert into capture_item (organization_id, owner_id, kind, title, body, email_from)
    values (v_org, v_staff, 'email', 'Zzexport captured', 'Zzexport private body', 'zzexport-donor@example.com');
  insert into crm_sensitive_note (organization_id, crm_contact_id, notes) values (v_org, v_contact, 'Zzexport sensitive note');

  v_export := public.contact_data_export(v_org, v_contact);
  perform tests.ok(v_export -> 'crm_contact.id' -> 0 ->> 'full_name' = 'Zzexport Donor', 'contact export: the contact record is in it');
  perform tests.ok(jsonb_array_length(v_export -> 'capture_item.email_from') = 1 and not (v_export::text like '%private body%'),
    'contact export: someone''s captured email from the contact is listed, but not its private content');
  perform tests.ok(not (v_export::text like '%sensitive note%'),
    'contact export: a contact nobody owns carries no sensitive notes, as its read rule says');
  update crm_contact set owner_id = v_owner where id = v_contact;
  v_export := public.contact_data_export(v_org, v_contact);
  perform tests.ok(v_export::text like '%sensitive note%', 'contact export: an owned contact''s sensitive notes are in it');
  perform tests.ok(v_export::text like '%spring gift%', 'contact export: the contact''s interactions are in it');
  perform tests.ok(not (v_export::text like '%other organization call%') and not (v_export::text like '%' || v_other_contact || '%'),
    'contact export: nothing from another organization is in it, even under the same email address');
  begin
    perform public.contact_data_export(v_org, v_other_contact);
    perform tests.ok(false, 'contact export: a contact of another organization is refused');
  exception when sqlstate '22023' then
    perform tests.ok(true, 'contact export: a contact of another organization is refused');
  end;

  perform tests.ok(
    not has_function_privilege('authenticated', 'public.person_data_export(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.person_data_export(uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.contact_data_export(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.contact_data_export(uuid, uuid)', 'execute')
      and has_function_privilege('service_role', 'public.contact_data_export(uuid, uuid)', 'execute'),
    'exports: only the export job (service role) can build a person or contact export');
  perform tests.ok(
    not has_table_privilege('authenticated', 'app.person_data_registry', 'select')
      and (select relrowsecurity from pg_class where oid = 'app.person_data_registry'::regclass),
    'exports: the registry is not readable through the API and has row security on');
end;
$$;

-- Who may ask for a contact export: owners and admins who completed MFA, for
-- a contact of their own organization.
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_other_org uuid;
  v_contact uuid;
  v_other_contact uuid;
  v_job uuid;
  q text := $q$insert into export_job (organization_id, kind, requested_by, subject_contact_id, subject_user_id)
              values (%L, %L, %L, %L, %L)$q$;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  insert into organization (name, slug) values ('Zzexport Req Org', 'zzexport-req-' || txid_current()) returning id into v_other_org;
  insert into crm_contact (organization_id, full_name) values (v_org, 'Zzexport Requested') returning id into v_contact;
  insert into crm_contact (organization_id, full_name) values (v_other_org, 'Zzexport Not Ours') returning id into v_other_contact;

  perform tests.authenticate(v_staff, 'aal2');
  perform tests.refused_ok(format(q, v_org, 'contact_data', v_staff, v_contact, null), 'contact export: staff cannot request one');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.refused_ok(format(q, v_org, 'contact_data', v_owner, v_contact, null), 'contact export: an owner without MFA cannot request one');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.refused_ok(format(q, v_org, 'contact_data', v_owner, v_other_contact, null),
    'contact export: a contact of another organization cannot be named');
  perform tests.refused_ok(format(q, v_org, 'contact_data', v_owner, null, null), 'contact export: a contact must be named');
  perform tests.refused_ok(format(q, v_org, 'organization_data', v_owner, v_contact, null),
    'exports: only a contact export names a contact');
  insert into export_job (organization_id, kind, requested_by, subject_contact_id)
    values (v_org, 'contact_data', v_owner, v_contact) returning id into v_job;
  perform tests.ok(v_job is not null, 'contact export: an owner with MFA can request one');
  perform tests.clear_auth();
  reset role;

  perform tests.ok(exists (
    select 1 from audit_event where object_id = v_job and action = 'export_requested'
      and metadata ->> 'subject_contact_id' = v_contact::text),
    'contact export: the request is audited with the contact it names');
end;
$$;

rollback;
