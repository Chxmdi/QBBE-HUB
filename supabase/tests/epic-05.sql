-- Epic #15 owned requirements: material audit, template approval, restore.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_project uuid;
  v_task uuid;
  v_doc uuid;
  v_decision uuid;
  v_template uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  perform tests.authenticate(v_owner);

  insert into public.project (organization_id, name, owner_id, created_by, stage, health)
  values (v_org, 'Epic05 audit project', v_owner, v_owner, 'active', 'on_track')
  returning id into v_project;

  insert into public.task (organization_id, project_id, title, created_by, assignee_id, status)
  values (v_org, v_project, 'Epic05 audit task', v_owner, v_owner, 'not_started')
  returning id into v_task;

  -- Due-date change writes audit with actor.
  update public.task set due_at = current_date + 3 where id = v_task;
  select count(*) into n
  from public.audit_event
  where object_id = v_task and event_type = 'task.due_date' and actor_id = v_owner;
  perform tests.ok(n >= 1, 'due-date change writes task.due_date audit with actor');

  -- Assignment change.
  update public.task set assignee_id = v_staff where id = v_task;
  select count(*) into n
  from public.audit_event
  where object_id = v_task and event_type = 'task.assignment' and actor_id = v_owner;
  perform tests.ok(n >= 1, 'assignee change writes task.assignment audit');

  -- Status change.
  update public.task set status = 'in_progress' where id = v_task;
  select count(*) into n
  from public.audit_event
  where object_id = v_task and event_type = 'task.status' and actor_id = v_owner;
  perform tests.ok(n >= 1, 'status change writes task.status audit');

  -- Health change on project.
  update public.project set health = 'at_risk', health_reason = 'Blocked on vendor' where id = v_project;
  select count(*) into n
  from public.audit_event
  where object_id = v_project and event_type = 'project.health' and actor_id = v_owner;
  perform tests.ok(n >= 1, 'health change writes project.health audit');

  -- Decision insert.
  insert into public.decision (organization_id, project_id, title, decided_by)
  values (v_org, v_project, 'Epic05 decision', v_owner)
  returning id into v_decision;
  select count(*) into n
  from public.audit_event
  where object_id = v_decision and event_type = 'decision' and actor_id = v_owner;
  perform tests.ok(n >= 1, 'decision insert writes decision audit');

  -- Task archive and restore.
  update public.task set archived_at = now() where id = v_task;
  select count(*) into n
  from public.audit_event
  where object_id = v_task and event_type = 'task.deletion' and action = 'archived';
  perform tests.ok(n >= 1, 'task archive writes task.deletion audit');

  update public.task set archived_at = null where id = v_task;
  select count(*) into n
  from public.audit_event
  where object_id = v_task and event_type = 'task.restore' and action = 'restored';
  perform tests.ok(n >= 1, 'task restore writes task.restore audit');

  -- Document archive and restore (link kind).
  insert into public.document (organization_id, title, kind, url, owner_id, created_by, visibility)
  values (v_org, 'Epic05 doc', 'link', 'https://drive.google.com/file/d/epic05', v_owner, v_owner, 'organization')
  returning id into v_doc;

  update public.document set archived_at = now() where id = v_doc;
  select count(*) into n
  from public.audit_event
  where object_id = v_doc and event_type = 'document.deletion' and action = 'archived';
  perform tests.ok(n >= 1, 'document archive writes document.deletion audit');

  update public.document set archived_at = null where id = v_doc;
  select count(*) into n
  from public.audit_event
  where object_id = v_doc and event_type = 'document.restore' and action = 'restored';
  perform tests.ok(n >= 1, 'document restore writes document.restore audit');

  -- Staff may draft a project template but cannot approve it.
  perform tests.authenticate(v_staff);
  insert into public.project_template (organization_id, name, created_by)
  values (v_org, 'Epic05 unapproved', v_staff)
  returning id into v_template;

  failed := false;
  begin
    update public.project_template
    set approved_at = now(), approved_by = v_staff
    where id = v_template;
  exception when insufficient_privilege then
    failed := true;
  end;
  perform tests.ok(failed, 'staff cannot set approved_at on a project template');

  -- Owner/admin can approve; unapproved stays unusable at the app layer,
  -- but the row itself remains draft until an admin sets both columns.
  perform tests.authenticate(v_owner);
  update public.project_template
  set approved_at = now(), approved_by = v_owner
  where id = v_template;
  select count(*) into n
  from public.project_template
  where id = v_template and approved_at is not null and approved_by = v_owner;
  perform tests.ok(n = 1, 'administrator can approve a project template');

  -- Record template: staff draft, staff cannot approve.
  perform tests.authenticate(v_staff);
  insert into public.record_template (organization_id, kind, name, structure, created_by)
  values (v_org, 'task', 'Epic05 task template', '{"title":"From template"}'::jsonb, v_staff)
  returning id into v_template;

  failed := false;
  begin
    update public.record_template
    set approved_at = now(), approved_by = v_staff
    where id = v_template;
  exception when insufficient_privilege then
    failed := true;
  end;
  perform tests.ok(failed, 'staff cannot approve a record_template');

  perform tests.authenticate(v_owner);
  update public.record_template
  set approved_at = now(), approved_by = v_owner
  where id = v_template;
  select count(*) into n
  from public.record_template
  where id = v_template and approved_at is not null;
  perform tests.ok(n = 1, 'administrator can approve a record_template');
end;
$$;

rollback;
