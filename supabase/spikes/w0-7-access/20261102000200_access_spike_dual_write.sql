-- W0-7 spike, part 2: today's tables written through to the new model.
--
-- NOT A MIGRATION (see 20261102000100). While the old tables stay the source
-- of truth, every change to them is mirrored into spike_access by the
-- triggers below, and the cache follows from that. The mapping:
--
--   organization          workspace space; org_role grants on it:
--                           owner, admin        -> org_reader, org_admin (MFA)
--                           leadership_viewer   -> org_reader
--   program               a space with the program's id, under the workspace
--   program.lead_id       manager on the space and the tasks directly in it,
--                         not its projects (reach self_and_direct_tasks:
--                         exactly what the lead column gives today)
--   program_access_grant  its role on the space, inherited by the projects
--                         and tasks under it
--   project               object under its program's space, or the workspace
--   project.owner_id      manager on the project
--   project_access_grant  its role on the project. Rows with source
--                         'program_inherited' are NOT copied: they are the
--                         old model's copy of a program grant, which the new
--                         model gets by inheritance.
--   task                  object under its project; with no project, under
--                         its program's space; with neither, the workspace
--   task.assignee_id,     contributor on the task
--   task.requester_id
--   task.reviewer_id,     approver on the task (read, review, approve)
--   task.approver_id
--   task_assignment       its role on the task

-- ---------------------------------------------------------------------------
-- Objects
-- ---------------------------------------------------------------------------

create or replace function spike_access.ensure_workspace(p_organization uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select s.id into v_id from spike_access.space s
  where s.organization_id = p_organization and s.kind = 'workspace';
  if found then
    return v_id;
  end if;
  v_id := gen_random_uuid();
  insert into spike_access.object (id, organization_id, kind, parent_id, ancestors)
  values (v_id, p_organization, 'space', null, array[v_id]);
  insert into spike_access.space (id, organization_id, kind, name)
  values (v_id, p_organization, 'workspace', 'Workspace');
  insert into spike_access.access_grant
    (organization_id, object_id, principal_kind, org_role, role_key, source)
  values
    (p_organization, v_id, 'org_role', 'owner', 'org_reader', 'org_role'),
    (p_organization, v_id, 'org_role', 'owner', 'org_admin', 'org_role'),
    (p_organization, v_id, 'org_role', 'admin', 'org_reader', 'org_role'),
    (p_organization, v_id, 'org_role', 'admin', 'org_admin', 'org_role'),
    (p_organization, v_id, 'org_role', 'leadership_viewer', 'org_reader', 'org_role');
  return v_id;
end;
$$;

-- Insert or move an object. A move rewrites the chain, which refreshes the
-- object and everything under it (spike_access.on_object_change).
create or replace function spike_access.put_object(
  p_id uuid, p_organization uuid, p_kind text, p_parent uuid
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_chain uuid[];
begin
  select array[p_id] || o.ancestors into strict v_chain
  from spike_access.object o where o.id = p_parent;
  insert into spike_access.object (id, organization_id, kind, parent_id, ancestors)
  values (p_id, p_organization, p_kind, p_parent, v_chain)
  on conflict (id) do update
    set parent_id = excluded.parent_id, ancestors = excluded.ancestors
    where spike_access.object.ancestors is distinct from excluded.ancestors;
end;
$$;

-- Replace the single grant a column gives (lead, owner, a task actor).
create or replace function spike_access.put_column_grant(
  p_organization uuid, p_object uuid, p_source text, p_user uuid,
  p_role text, p_reach text
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from spike_access.access_grant g
  where g.object_id = p_object and g.source = p_source and g.legacy_id = p_object
    and g.user_id is distinct from p_user;
  if p_user is not null then
    insert into spike_access.access_grant
      (organization_id, object_id, principal_kind, user_id, role_key, reach, source, legacy_id)
    values (p_organization, p_object, 'person', p_user, p_role, p_reach, p_source, p_object)
    on conflict do nothing;
  end if;
end;
$$;

create or replace function spike_access.sync_program(p public.program)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform spike_access.put_object(
    p.id, p.organization_id, 'space', spike_access.ensure_workspace(p.organization_id));
  insert into spike_access.space (id, organization_id, kind, program_id, name)
  values (p.id, p.organization_id, 'program', p.id, p.name)
  on conflict (id) do update set name = excluded.name;
  perform spike_access.put_column_grant(
    p.organization_id, p.id, 'program.lead_id', p.lead_id, 'manager', 'self_and_direct_tasks');
end;
$$;

create or replace function spike_access.ensure_program(p_program uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_program is not null
     and not exists (select 1 from spike_access.object where id = p_program) then
    perform spike_access.sync_program(p) from public.program p where p.id = p_program;
  end if;
end;
$$;

create or replace function spike_access.sync_project(p public.project)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform spike_access.ensure_program(p.program_id);
  perform spike_access.put_object(
    p.id, p.organization_id, 'project',
    coalesce(p.program_id, spike_access.ensure_workspace(p.organization_id)));
  perform spike_access.put_column_grant(
    p.organization_id, p.id, 'project.owner_id', p.owner_id, 'manager', 'subtree');
end;
$$;

create or replace function spike_access.ensure_project(p_project uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_project is not null
     and not exists (select 1 from spike_access.object where id = p_project) then
    perform spike_access.sync_project(p) from public.project p where p.id = p_project;
  end if;
end;
$$;

create or replace function spike_access.sync_task(t public.task)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform spike_access.ensure_project(t.project_id);
  perform spike_access.ensure_program(t.program_id);
  perform spike_access.put_object(
    t.id, t.organization_id, 'task',
    case
      when t.project_id is not null then t.project_id
      when t.program_id is not null then t.program_id
      else spike_access.ensure_workspace(t.organization_id)
    end);
  perform spike_access.put_column_grant(t.organization_id, t.id, 'task.assignee_id', t.assignee_id, 'contributor', 'subtree');
  perform spike_access.put_column_grant(t.organization_id, t.id, 'task.requester_id', t.requester_id, 'contributor', 'subtree');
  perform spike_access.put_column_grant(t.organization_id, t.id, 'task.reviewer_id', t.reviewer_id, 'approver', 'subtree');
  perform spike_access.put_column_grant(t.organization_id, t.id, 'task.approver_id', t.approver_id, 'approver', 'subtree');
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers on today's tables. Named a_* so they run before the existing
-- sync_* triggers, which write grants that need these objects to exist.
-- ---------------------------------------------------------------------------

create or replace function spike_access.on_legacy_record()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from spike_access.object where id = old.id;
    return null;
  end if;
  case tg_table_name
    when 'program' then perform spike_access.sync_program(new);
    when 'project' then perform spike_access.sync_project(new);
    when 'task' then perform spike_access.sync_task(new);
  end case;
  return null;
end;
$$;

create trigger a_spike_access_sync after insert or delete
  or update of organization_id, lead_id, name on public.program
  for each row execute function spike_access.on_legacy_record();
create trigger a_spike_access_sync after insert or delete
  or update of organization_id, program_id, owner_id on public.project
  for each row execute function spike_access.on_legacy_record();
create trigger a_spike_access_sync after insert or delete
  or update of organization_id, program_id, project_id, assignee_id, requester_id,
               reviewer_id, approver_id on public.task
  for each row execute function spike_access.on_legacy_record();

create or replace function spike_access.map_program_role(p_role public.program_access_role)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'lead' then 'manager' when 'manager' then 'manager'
    when 'contributor' then 'contributor' when 'reviewer' then 'reviewer'
    when 'follower' then 'follower' when 'read_only' then 'read_only'
  end;
$$;

create or replace function spike_access.map_project_role(p_role public.project_access_role)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'project_manager' then 'manager' when 'contributor' then 'contributor'
    when 'reviewer' then 'reviewer' when 'approver' then 'approver'
    when 'follower' then 'follower' when 'read_only' then 'read_only'
  end;
$$;

create or replace function spike_access.on_legacy_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    if tg_table_name = 'task_assignment' then
      delete from spike_access.access_grant g
      where g.object_id = old.task_id and g.user_id = old.user_id
        and g.source = 'task_assignment' and g.role_key = old.role::text;
    else
      delete from spike_access.access_grant g
      where g.source = tg_table_name and g.legacy_id = old.id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    case tg_table_name
      when 'program_access_grant' then
        perform spike_access.ensure_program(new.program_id);
        insert into spike_access.access_grant
          (organization_id, object_id, principal_kind, user_id, role_key, source, legacy_id)
        values (new.organization_id, new.program_id, 'person', new.user_id,
                spike_access.map_program_role(new.role), tg_table_name, new.id);
      when 'project_access_grant' then
        if new.source <> 'program_inherited' then
          perform spike_access.ensure_project(new.project_id);
          insert into spike_access.access_grant
            (organization_id, object_id, principal_kind, user_id, role_key, source, legacy_id)
          values (new.organization_id, new.project_id, 'person', new.user_id,
                  spike_access.map_project_role(new.role), tg_table_name, new.id);
        end if;
      when 'task_assignment' then
        insert into spike_access.access_grant
          (organization_id, object_id, principal_kind, user_id, role_key, source)
        select t.organization_id, t.id, 'person', new.user_id, new.role::text, 'task_assignment'
        from public.task t where t.id = new.task_id
        on conflict do nothing;
    end case;
  end if;
  return null;
end;
$$;

create trigger a_spike_access_sync after insert or update or delete on public.program_access_grant
  for each row execute function spike_access.on_legacy_grant();
create trigger a_spike_access_sync after insert or update or delete on public.project_access_grant
  for each row execute function spike_access.on_legacy_grant();
create trigger a_spike_access_sync after insert or update or delete on public.task_assignment
  for each row execute function spike_access.on_legacy_grant();

create or replace function spike_access.on_organization_insert()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform spike_access.ensure_workspace(new.id);
  return null;
end;
$$;
create trigger a_spike_access_sync after insert on public.organization
  for each row execute function spike_access.on_organization_insert();

-- ---------------------------------------------------------------------------
-- Backfill: mirror everything, then build the cache once.
-- ---------------------------------------------------------------------------

-- Rebuild the whole cache from the grants. Also what the equivalence test
-- compares the trigger-maintained cache against.
create or replace function spike_access.rebuild()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  truncate spike_access.access_cache;
  insert into spike_access.access_cache (user_id, object_id, organization_id, caps)
  select x.user_id, x.object_id, x.organization_id, x.caps
  from spike_access.compute((select array_agg(id) from spike_access.object)) x
  where x.caps <> 0;
end;
$$;

do $$
declare
  v_member record;
  v_space uuid;
begin
  perform set_config('spike_access.bulk', 'on', true);
  perform spike_access.ensure_workspace(o.id) from public.organization o;
  -- A Private space per member, owned (manager) by them, to show the shape.
  -- Nothing is in them yet, and nothing else inherits from them.
  for v_member in
    select m.organization_id, m.user_id from public.organization_membership m
    where m.status = 'active'
  loop
    v_space := gen_random_uuid();
    perform spike_access.put_object(v_space, v_member.organization_id, 'space',
      spike_access.ensure_workspace(v_member.organization_id));
    insert into spike_access.space (id, organization_id, kind, owner_id, name)
    values (v_space, v_member.organization_id, 'private', v_member.user_id, 'Private');
    insert into spike_access.access_grant
      (organization_id, object_id, principal_kind, user_id, role_key, source)
    values (v_member.organization_id, v_space, 'person', v_member.user_id, 'manager', 'private_space');
  end loop;
  perform spike_access.sync_program(p) from public.program p;
  perform spike_access.sync_project(p) from public.project p;
  perform spike_access.sync_task(t) from public.task t;
  insert into spike_access.access_grant
    (organization_id, object_id, principal_kind, user_id, role_key, source, legacy_id)
  select g.organization_id, g.program_id, 'person', g.user_id,
         spike_access.map_program_role(g.role), 'program_access_grant', g.id
  from public.program_access_grant g;
  insert into spike_access.access_grant
    (organization_id, object_id, principal_kind, user_id, role_key, source, legacy_id)
  select g.organization_id, g.project_id, 'person', g.user_id,
         spike_access.map_project_role(g.role), 'project_access_grant', g.id
  from public.project_access_grant g
  where g.source <> 'program_inherited';
  insert into spike_access.access_grant
    (organization_id, object_id, principal_kind, user_id, role_key, source)
  select t.organization_id, t.id, 'person', ta.user_id, ta.role::text, 'task_assignment'
  from public.task_assignment ta join public.task t on t.id = ta.task_id
  on conflict do nothing;
  perform set_config('spike_access.bulk', 'off', true);
  perform spike_access.rebuild();
end
$$;
