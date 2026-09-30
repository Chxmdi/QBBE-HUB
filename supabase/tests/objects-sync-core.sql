-- Workspace OS M1b: every task and project has exactly one object, and the
-- counts stay equal through inserts, updates and deletes
-- (20261101010200_object_sync_tasks_projects.sql). Run after qa-users.sql and
-- rls.sql. All mutations are rolled back.
begin;

-- For one native table: rows without an object, objects without a row (of
-- that type), and objects whose type or organization disagree with the row.
create or replace function tests.objects_sync_gaps(p_table text, p_type text)
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

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_project_two uuid;
  v_task uuid;
  v_task_by_owner uuid;
  v_updated_at timestamptz;
  v_tasks_before bigint;
  v_objects_before bigint;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  -- Backfill: whatever existed before this file ran has its object.
  perform tests.ok(tests.objects_sync_gaps('project', 'project') = 0,
    'every existing project has exactly one object of type project');
  perform tests.ok(tests.objects_sync_gaps('task', 'task') = 0,
    'every existing task has exactly one object of type task');
  perform tests.ok(
    (select count(*) from public.task) = (select count(*) from public.object o
      join public.object_type t on t.id = o.type_id where t.key = 'task'),
    'task and task-object counts are equal'
  );

  -- Inserts.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Sync', 'sync-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Sync project', v_owner, v_owner)
  returning id into v_project;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Second sync project', v_staff, v_owner)
  returning id into v_project_two;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Book the hall', v_owner, v_volunteer)
  returning id into v_task;

  perform tests.ok(
    exists (select 1 from public.object o where o.id = v_project and o.title = 'Sync project'
      and o.owner_id = v_owner and o.created_by = v_owner and o.parent_object_id is null),
    'a new project gets its object with title, owner and creator'
  );
  perform tests.ok(
    exists (select 1 from public.object o where o.id = v_task and o.title = 'Book the hall'
      and o.owner_id = v_volunteer and o.parent_object_id = v_project),
    'a new task gets its object, owned by its assignee, inside its project'
  );
  perform tests.ok(tests.objects_sync_gaps('task', 'task') = 0
      and tests.objects_sync_gaps('project', 'project') = 0,
    'counts stay equal after inserts');

  -- Updates.
  update public.task set title = 'Book the big hall', project_id = v_project_two where id = v_task;
  perform tests.ok(
    exists (select 1 from public.object o where o.id = v_task
      and o.title = 'Book the big hall' and o.parent_object_id = v_project_two),
    'renaming a task and moving it to another project updates its object'
  );
  update public.task set archived_at = '2026-09-01T00:00:00Z' where id = v_task;
  perform tests.ok(
    (select archived_at from public.object where id = v_task) = '2026-09-01T00:00:00Z'::timestamptz,
    'archiving a task archives its object'
  );
  update public.task set archived_at = null where id = v_task;
  perform tests.ok(
    (select archived_at from public.object where id = v_task) is null,
    'restoring a task restores its object'
  );
  update public.project set name = 'Renamed project', owner_id = v_staff where id = v_project;
  perform tests.ok(
    exists (select 1 from public.object o where o.id = v_project
      and o.title = 'Renamed project' and o.owner_id = v_staff),
    'renaming a project or changing its owner updates its object'
  );

  -- An update the object does not copy leaves the object alone.
  -- Pin the object's updated_at without set_updated_at rewriting it.
  alter table public.object disable trigger object_updated_at;
  update public.object set updated_at = '2020-01-01T00:00:00Z' where id = v_task;
  alter table public.object enable trigger object_updated_at;
  update public.task set sort_key = coalesce(sort_key, 0) + 1 where id = v_task;
  select updated_at into v_updated_at from public.object where id = v_task;
  perform tests.ok(v_updated_at = '2020-01-01T00:00:00Z'::timestamptz,
    'moving a task on a board (sort_key only) does not rewrite its object');

  -- A signed-in person creating a task through the API gets its object,
  -- although they cannot write object themselves.
  perform tests.authenticate(v_owner);
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Created through the API', v_owner)
  returning id into v_task_by_owner;
  perform tests.ok(
    exists (select 1 from public.object where id = v_task_by_owner),
    'a task created by a signed-in person has its object, visible to them'
  );
  reset role;

  -- Deletes.
  select count(*) into v_tasks_before from public.task;
  select count(*) into v_objects_before from public.object o
    join public.object_type t on t.id = o.type_id where t.key = 'task';
  delete from public.task where id = v_task;
  perform tests.ok(
    not exists (select 1 from public.object where id = v_task)
      and (select count(*) from public.task) = v_tasks_before - 1
      and (select count(*) from public.object o join public.object_type t on t.id = o.type_id
           where t.key = 'task') = v_objects_before - 1,
    'deleting a task deletes its object and the counts stay equal'
  );
  delete from public.task where project_id = v_project;
  delete from public.project where id = v_project;
  perform tests.ok(not exists (select 1 from public.object where id = v_project),
    'deleting a project deletes its object');
  perform tests.ok(tests.objects_sync_gaps('task', 'task') = 0
      and tests.objects_sync_gaps('project', 'project') = 0,
    'counts stay equal after deletes');
end;
$$;

rollback;
