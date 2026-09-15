-- Core scoped-access cutover. The grant tables and capability predicates were
-- prepared in the preceding migrations. This migration makes the program →
-- project → milestone/task hierarchy consume them, while keeping unrelated
-- communication, file, team and integration policies for later cutovers.

create or replace function app.can_read_program(p_program uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_program_capability(p_program, 'read');
$$;

create or replace function app.can_manage_program(p_program uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_program_capability(p_program, 'manage');
$$;

create or replace function app.can_read_project(p_project uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_project_capability(p_project, 'read');
$$;

create or replace function app.can_manage_project(p_project uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_project_capability(p_project, 'manage');
$$;

revoke all on function app.can_read_program(uuid) from public, anon;
revoke all on function app.can_manage_program(uuid) from public, anon;
revoke all on function app.can_read_project(uuid) from public, anon;
revoke all on function app.can_manage_project(uuid) from public, anon;
grant execute on function app.can_read_program(uuid) to authenticated, service_role;
grant execute on function app.can_manage_program(uuid) to authenticated, service_role;
grant execute on function app.can_read_project(uuid) to authenticated, service_role;
grant execute on function app.can_manage_project(uuid) to authenticated, service_role;

create or replace function app.has_task_capability(
  p_task uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.task t
    join public.organization_membership m
      on m.organization_id = t.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where t.id = p_task
      and lower(coalesce(p_capability, '')) in (
        'read', 'manage', 'collaborate', 'review', 'approve', 'follow'
      )
      and not (
        m.role in ('owner', 'admin')
        and lower(p_capability) <> 'read'
        and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
      )
      and not (
        m.role = 'leadership_viewer'
        and lower(p_capability) <> 'read'
      )
      and (
        (
          m.role in ('owner', 'admin')
          and (
            lower(p_capability) = 'read'
            or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
          )
        )
        or (m.role = 'leadership_viewer' and lower(p_capability) = 'read')
        or (
          t.project_id is not null
          and app.has_project_capability(t.project_id, p_capability)
        )
        or (
          t.project_id is null and t.program_id is not null
          and app.has_program_capability(t.program_id, p_capability)
        )
        or (
          t.assignee_id = (select auth.uid())
          and lower(p_capability) in ('read', 'collaborate')
        )
        or (
          t.requester_id = (select auth.uid())
          and lower(p_capability) in ('read', 'collaborate')
        )
        or (
          t.reviewer_id = (select auth.uid())
          and lower(p_capability) in ('read', 'review', 'approve')
        )
      )
  );
$$;

create or replace function public.has_task_capability(
  p_task uuid,
  p_capability text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_task_capability(p_task, p_capability);
$$;

revoke all on function app.has_task_capability(uuid, text)
  from public, anon, authenticated;
revoke all on function public.has_task_capability(uuid, text) from public, anon;
grant execute on function app.has_task_capability(uuid, text)
  to service_role;
grant execute on function public.has_task_capability(uuid, text)
  to authenticated, service_role;

create or replace function app.can_create_scoped_task(
  p_organization uuid,
  p_program uuid,
  p_project uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.organization_membership m
      where m.organization_id = p_organization
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
    and (
      (
        p_project is not null
        and exists (
          select 1 from public.project p
          where p.id = p_project and p.organization_id = p_organization
        )
        and app.has_project_capability(p_project, 'collaborate')
      )
      or (
        p_project is null and p_program is not null
        and exists (
          select 1 from public.program p
          where p.id = p_program and p.organization_id = p_organization
        )
        and app.has_program_capability(p_program, 'collaborate')
      )
      or (
        p_project is null and p_program is null
        and app.is_org_admin(p_organization)
      )
    );
$$;

create or replace function public.can_create_scoped_task(
  p_organization uuid,
  p_program uuid,
  p_project uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.can_create_scoped_task(p_organization, p_program, p_project);
$$;

revoke all on function app.can_create_scoped_task(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.can_create_scoped_task(uuid, uuid, uuid)
  from public, anon;
grant execute on function app.can_create_scoped_task(uuid, uuid, uuid)
  to service_role;
grant execute on function public.can_create_scoped_task(uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function app.validate_program_scope_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'A program cannot move between organizations.' using errcode = '23514';
  end if;

  if new.lead_id is not null and not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.lead_id and m.status = 'active'
  ) then
    raise exception 'Program lead must be an active member of the same organization.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app.validate_project_scope_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'A project cannot move between organizations.' using errcode = '23514';
  end if;

  if new.program_id is not null and not exists (
    select 1 from public.program p
    where p.id = new.program_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Project program must belong to the same organization.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
    and new.program_id is distinct from old.program_id
    and auth.uid() is not null
    and coalesce(auth.jwt()->>'role', '') <> 'service_role'
    and not (
      app.is_org_admin(new.organization_id)
      or (
        new.program_id is not null
        and app.has_program_capability(new.program_id, 'manage')
      )
    ) then
    raise exception 'Managing the destination program is required.'
      using errcode = '42501';
  end if;

  if new.owner_id is not null and not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.owner_id and m.status = 'active'
  ) then
    raise exception 'Project owner must be an active member of the same organization.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app.validate_task_scope_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_project public.project;
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'A task cannot move between organizations.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT'
    or new.program_id is distinct from old.program_id
    or new.project_id is distinct from old.project_id
    or new.milestone_id is distinct from old.milestone_id then
    if new.project_id is not null then
      select * into v_project from public.project where id = new.project_id;
      if not found or v_project.organization_id <> new.organization_id then
        raise exception 'Task project must belong to the same organization.'
          using errcode = '23514';
      end if;
      -- Project context is authoritative. Deriving the program also keeps
      -- legacy/API callers that provide only project_id consistent when a task
      -- is created or moved.
      new.program_id := v_project.program_id;
    elsif new.program_id is not null and not exists (
      select 1 from public.program p
      where p.id = new.program_id and p.organization_id = new.organization_id
    ) then
      raise exception 'Task program must belong to the same organization.'
        using errcode = '23514';
    end if;

    if new.milestone_id is not null and (
      new.project_id is null or not exists (
        select 1 from public.milestone m
        where m.id = new.milestone_id and m.project_id = new.project_id
      )
    ) then
      raise exception 'Task milestone must belong to its project.' using errcode = '23514';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
    and new.assignee_id is not null and not exists (
      select 1 from public.organization_membership m
      where m.organization_id = new.organization_id
        and m.user_id = new.assignee_id and m.status = 'active'
    ) then
    raise exception 'Task assignee must be an active member of the same organization.'
      using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.requester_id is distinct from old.requester_id)
    and new.requester_id is not null and not exists (
      select 1 from public.organization_membership m
      where m.organization_id = new.organization_id
        and m.user_id = new.requester_id and m.status = 'active'
    ) then
    raise exception 'Task requester must be an active member of the same organization.'
      using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id)
    and new.reviewer_id is not null and not exists (
      select 1 from public.organization_membership m
      where m.organization_id = new.organization_id
        and m.user_id = new.reviewer_id and m.status = 'active'
    ) then
    raise exception 'Task reviewer must be an active member of the same organization.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app.enforce_scoped_task_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or coalesce(auth.jwt()->>'role', '') = 'service_role' then
    return new;
  end if;

  if app.has_task_capability(old.id, 'manage') then
    return new;
  end if;

  if app.has_task_capability(old.id, 'review')
    or app.has_task_capability(old.id, 'approve') then
    if old.status = 'in_review'
      and new.status in ('in_review', 'ready', 'completed')
      and (to_jsonb(new) - 'status' - 'completed_at' - 'updated_at')
        = (to_jsonb(old) - 'status' - 'completed_at' - 'updated_at') then
      return new;
    end if;
    raise exception 'Reviewers may only decide a task that is in review.'
      using errcode = '42501';
  end if;

  if app.has_task_capability(old.id, 'collaborate') then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.program_id is distinct from old.program_id
      or new.project_id is distinct from old.project_id
      or new.milestone_id is distinct from old.milestone_id
      or new.assignee_id is distinct from old.assignee_id
      or new.requester_id is distinct from old.requester_id
      or new.reviewer_id is distinct from old.reviewer_id
      or new.source_message_id is distinct from old.source_message_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.archived_at is distinct from old.archived_at
      or new.recurrence_rule is distinct from old.recurrence_rule
      or new.recurrence_anchor is distinct from old.recurrence_anchor
      or new.recurrence_parent_id is distinct from old.recurrence_parent_id then
      raise exception 'Contributors cannot change task authority or operational context.'
        using errcode = '42501';
    end if;
    if old.reviewer_id is not null and new.status = 'completed'
      and old.status <> 'completed' then
      raise exception 'A task with a reviewer must be decided through review.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Task update is outside the actor''s scoped capability.'
    using errcode = '42501';
end;
$$;

create or replace function app.validate_program_membership_scope()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_organization uuid;
begin
  select organization_id into v_organization
  from public.program where id = new.program_id;
  if v_organization is null or not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_organization
      and m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'Program membership requires an active same-organization member.'
      using errcode = '23514';
  end if;
  if lower(coalesce(trim(new.role), '')) not in (
    'lead', 'manager', 'contributor', 'member', 'reviewer', 'follower',
    'read_only', 'readonly', 'guest'
  ) then
    raise exception 'Unknown program membership role.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.validate_project_membership_scope()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_organization uuid;
begin
  select organization_id into v_organization
  from public.project where id = new.project_id;
  if v_organization is null or not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_organization
      and m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'Project membership requires an active same-organization member.'
      using errcode = '23514';
  end if;
  if lower(coalesce(trim(new.role), '')) not in (
    'project_manager', 'manager', 'owner', 'contributor', 'member',
    'reviewer', 'approver', 'follower', 'read_only', 'readonly', 'guest'
  ) then
    raise exception 'Unknown project membership role.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.sync_legacy_program_membership_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_organization uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.program_access_grant
    where program_id = old.program_id and user_id = old.user_id
      and source = 'legacy_membership';
  end if;
  if tg_op <> 'DELETE' then
    select organization_id into strict v_organization
    from public.program where id = new.program_id;
    insert into public.program_access_grant (
      organization_id, program_id, user_id, role, source, legacy_role
    ) values (
      v_organization, new.program_id, new.user_id,
      app.map_legacy_program_role(new.role), 'legacy_membership', new.role
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app.sync_legacy_project_membership_grant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_organization uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.project_access_grant
    where project_id = old.project_id and user_id = old.user_id
      and source = 'legacy_membership';
  end if;
  if tg_op <> 'DELETE' then
    select organization_id into strict v_organization
    from public.project where id = new.project_id;
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, legacy_role
    ) values (
      v_organization, new.project_id, new.user_id,
      app.map_legacy_project_role(new.role), 'legacy_membership', new.role
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app.validate_program_scope_write() from public, anon, authenticated;
revoke all on function app.validate_project_scope_write() from public, anon, authenticated;
revoke all on function app.validate_task_scope_write() from public, anon, authenticated;
revoke all on function app.enforce_scoped_task_update() from public, anon, authenticated;
revoke all on function app.validate_program_membership_scope() from public, anon, authenticated;
revoke all on function app.validate_project_membership_scope() from public, anon, authenticated;
revoke all on function app.sync_legacy_program_membership_grant() from public, anon, authenticated;
revoke all on function app.sync_legacy_project_membership_grant() from public, anon, authenticated;

create trigger validate_program_scope_write
before insert or update of organization_id, lead_id on public.program
for each row execute function app.validate_program_scope_write();

create trigger validate_project_scope_write
before insert or update of organization_id, program_id, owner_id on public.project
for each row execute function app.validate_project_scope_write();

create trigger validate_task_scope_write
before insert or update of organization_id, program_id, project_id, milestone_id,
  assignee_id, requester_id, reviewer_id on public.task
for each row execute function app.validate_task_scope_write();

create trigger enforce_scoped_task_update
before update on public.task
for each row execute function app.enforce_scoped_task_update();

create trigger validate_program_membership_scope
before insert or update on public.program_membership
for each row execute function app.validate_program_membership_scope();
create trigger sync_legacy_program_membership_grant
after insert or update or delete on public.program_membership
for each row execute function app.sync_legacy_program_membership_grant();

create trigger validate_project_membership_scope
before insert or update on public.project_membership
for each row execute function app.validate_project_membership_scope();
create trigger sync_legacy_project_membership_grant
after insert or update or delete on public.project_membership
for each row execute function app.sync_legacy_project_membership_grant();

create or replace function app.guard_task_comment_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id is distinct from old.task_id
    or new.author_id is distinct from old.author_id then
    raise exception 'A task comment cannot change its task or author.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_task_comment_identity()
  from public, anon, authenticated;
create trigger guard_task_comment_identity
before update on public.task_comment
for each row execute function app.guard_task_comment_identity();

-- Direct grant changes go through atomic, audited commands. Authenticated
-- users retain read access to provenance when their AAL2 admin policy passes,
-- but cannot bypass these commands with table writes.
revoke insert, update, delete on table public.program_access_grant from authenticated;
revoke insert, update, delete on table public.project_access_grant from authenticated;
drop policy if exists program_access_grant_admin_insert on public.program_access_grant;
drop policy if exists program_access_grant_admin_delete on public.program_access_grant;
drop policy if exists project_access_grant_admin_insert on public.project_access_grant;
drop policy if exists project_access_grant_admin_delete on public.project_access_grant;

create or replace function public.set_program_direct_access(
  p_program uuid,
  p_user uuid,
  p_role public.program_access_role
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_grant uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select organization_id into v_organization
  from public.program where id = p_program
  for update;
  if v_organization is null then
    raise exception 'Program not found.' using errcode = '22023';
  end if;
  if not app.is_org_admin(v_organization) then
    raise exception 'AAL2 organization administrator access is required.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_organization
      and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception 'Target must be an active member of the program organization.'
      using errcode = '22023';
  end if;

  select id into v_grant
  from public.program_access_grant
  where program_id = p_program and user_id = p_user and source = 'direct'
  for update;

  if v_grant is null then
    insert into public.program_access_grant (
      organization_id, program_id, user_id, role, source, created_by
    ) values (
      v_organization, p_program, p_user, p_role, 'direct', v_actor
    ) returning id into v_grant;
  else
    update public.program_access_grant
    set role = p_role, created_by = v_actor
    where id = v_grant;
  end if;

  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_organization, v_actor, 'access', 'direct_program_access_set',
    'program_access_grant', v_grant,
    jsonb_build_object('program_id', p_program, 'user_id', p_user, 'role', p_role)
  );
  return v_grant;
end;
$$;

create or replace function public.remove_program_direct_access(
  p_program uuid,
  p_user uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_grant uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select organization_id into v_organization
  from public.program where id = p_program
  for update;
  if v_organization is null or not app.is_org_admin(v_organization) then
    raise exception 'AAL2 organization administrator access is required.'
      using errcode = '42501';
  end if;

  delete from public.program_access_grant
  where program_id = p_program and user_id = p_user and source = 'direct'
  returning id into v_grant;
  if v_grant is null then
    raise exception 'Direct program grant not found.' using errcode = '22023';
  end if;

  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_organization, v_actor, 'access', 'direct_program_access_removed',
    'program_access_grant', v_grant,
    jsonb_build_object('program_id', p_program, 'user_id', p_user)
  );
  return v_grant;
end;
$$;

create or replace function public.set_project_direct_access(
  p_project uuid,
  p_user uuid,
  p_role public.project_access_role
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_grant uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select organization_id into v_organization
  from public.project where id = p_project
  for update;
  if v_organization is null then
    raise exception 'Project not found.' using errcode = '22023';
  end if;
  if not app.is_org_admin(v_organization) then
    raise exception 'AAL2 organization administrator access is required.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_organization
      and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception 'Target must be an active member of the project organization.'
      using errcode = '22023';
  end if;

  select id into v_grant
  from public.project_access_grant
  where project_id = p_project and user_id = p_user and source = 'direct'
  for update;

  if v_grant is null then
    insert into public.project_access_grant (
      organization_id, project_id, user_id, role, source, created_by
    ) values (
      v_organization, p_project, p_user, p_role, 'direct', v_actor
    ) returning id into v_grant;
  else
    update public.project_access_grant
    set role = p_role, created_by = v_actor
    where id = v_grant;
  end if;

  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_organization, v_actor, 'access', 'direct_project_access_set',
    'project_access_grant', v_grant,
    jsonb_build_object('project_id', p_project, 'user_id', p_user, 'role', p_role)
  );
  return v_grant;
end;
$$;

create or replace function public.remove_project_direct_access(
  p_project uuid,
  p_user uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_grant uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select organization_id into v_organization
  from public.project where id = p_project
  for update;
  if v_organization is null or not app.is_org_admin(v_organization) then
    raise exception 'AAL2 organization administrator access is required.'
      using errcode = '42501';
  end if;

  delete from public.project_access_grant
  where project_id = p_project and user_id = p_user and source = 'direct'
  returning id into v_grant;
  if v_grant is null then
    raise exception 'Direct project grant not found.' using errcode = '22023';
  end if;

  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    v_organization, v_actor, 'access', 'direct_project_access_removed',
    'project_access_grant', v_grant,
    jsonb_build_object('project_id', p_project, 'user_id', p_user)
  );
  return v_grant;
end;
$$;

revoke all on function public.set_program_direct_access(
  uuid, uuid, public.program_access_role
) from public, anon;
revoke all on function public.remove_program_direct_access(uuid, uuid)
  from public, anon;
revoke all on function public.set_project_direct_access(
  uuid, uuid, public.project_access_role
) from public, anon;
revoke all on function public.remove_project_direct_access(uuid, uuid)
  from public, anon;
grant execute on function public.set_program_direct_access(
  uuid, uuid, public.program_access_role
) to authenticated;
grant execute on function public.remove_program_direct_access(uuid, uuid)
  to authenticated;
grant execute on function public.set_project_direct_access(
  uuid, uuid, public.project_access_role
) to authenticated;
grant execute on function public.remove_project_direct_access(uuid, uuid)
  to authenticated;

-- Programs and their explicit membership rows.
drop policy if exists program_read on public.program;
create policy program_read on public.program for select to authenticated
  using (public.has_program_capability(id, 'read'));
drop policy if exists program_staff_insert on public.program;
create policy program_scoped_insert on public.program for insert to authenticated
  with check (app.is_org_admin(organization_id));
drop policy if exists program_staff_update on public.program;
create policy program_scoped_update on public.program for update to authenticated
  using (public.has_program_capability(id, 'manage'))
  with check (public.has_program_capability(id, 'manage'));
drop policy if exists program_admin_delete on public.program;
create policy program_admin_delete on public.program for delete to authenticated
  using (app.is_org_admin(organization_id));

drop policy if exists program_membership_read on public.program_membership;
create policy program_membership_read on public.program_membership for select to authenticated
  using (public.has_program_capability(program_id, 'read'));
drop policy if exists program_membership_staff_write on public.program_membership;
create policy program_membership_scoped_insert
  on public.program_membership for insert to authenticated
  with check (public.has_program_capability(program_id, 'manage'));
create policy program_membership_scoped_update
  on public.program_membership for update to authenticated
  using (public.has_program_capability(program_id, 'manage'))
  with check (public.has_program_capability(program_id, 'manage'));
create policy program_membership_scoped_delete
  on public.program_membership for delete to authenticated
  using (public.has_program_capability(program_id, 'manage'));

-- Projects inherit program grants; a direct project grant reaches no sibling.
drop policy if exists project_read on public.project;
create policy project_read on public.project for select to authenticated
  using (public.has_project_capability(id, 'read'));
drop policy if exists project_staff_insert on public.project;
create policy project_scoped_insert on public.project for insert to authenticated
  with check (
    (program_id is null and app.is_org_admin(organization_id))
    or (
      program_id is not null
      and public.has_program_capability(program_id, 'manage')
    )
  );
drop policy if exists project_staff_update on public.project;
create policy project_scoped_update on public.project for update to authenticated
  using (public.has_project_capability(id, 'manage'))
  with check (public.has_project_capability(id, 'manage'));
drop policy if exists project_admin_delete on public.project;
create policy project_admin_delete on public.project for delete to authenticated
  using (app.is_org_admin(organization_id));

drop policy if exists project_membership_read on public.project_membership;
create policy project_membership_read on public.project_membership for select to authenticated
  using (public.has_project_capability(project_id, 'read'));
drop policy if exists project_membership_staff_write on public.project_membership;
create policy project_membership_scoped_insert
  on public.project_membership for insert to authenticated
  with check (public.has_project_capability(project_id, 'manage'));
create policy project_membership_scoped_update
  on public.project_membership for update to authenticated
  using (public.has_project_capability(project_id, 'manage'))
  with check (public.has_project_capability(project_id, 'manage'));
create policy project_membership_scoped_delete
  on public.project_membership for delete to authenticated
  using (public.has_project_capability(project_id, 'manage'));

-- Milestones inherit their project and remain a management operation.
drop policy if exists milestone_read on public.milestone;
create policy milestone_read on public.milestone for select to authenticated
  using (public.has_project_capability(project_id, 'read'));
drop policy if exists milestone_staff_write on public.milestone;
create policy milestone_scoped_insert on public.milestone for insert to authenticated
  with check (public.has_project_capability(project_id, 'manage'));
create policy milestone_scoped_update on public.milestone for update to authenticated
  using (public.has_project_capability(project_id, 'manage'))
  with check (public.has_project_capability(project_id, 'manage'));
create policy milestone_scoped_delete on public.milestone for delete to authenticated
  using (public.has_project_capability(project_id, 'manage'));

-- Tasks allow scoped contributors and assigned actors to collaborate. Reviewer
-- decisions are constrained by enforce_scoped_task_update above.
drop policy if exists task_read on public.task;
create policy task_read on public.task for select to authenticated
  using (public.has_task_capability(id, 'read'));
drop policy if exists task_member_insert on public.task;
create policy task_scoped_insert on public.task for insert to authenticated
  with check (public.can_create_scoped_task(organization_id, program_id, project_id));
drop policy if exists task_update on public.task;
create policy task_scoped_update on public.task for update to authenticated
  using (
    public.has_task_capability(id, 'manage')
    or public.has_task_capability(id, 'collaborate')
    or public.has_task_capability(id, 'review')
    or public.has_task_capability(id, 'approve')
  )
  with check (
    public.has_task_capability(id, 'manage')
    or public.has_task_capability(id, 'collaborate')
    or public.has_task_capability(id, 'review')
    or public.has_task_capability(id, 'approve')
  );
drop policy if exists task_admin_delete on public.task;
create policy task_scoped_delete on public.task for delete to authenticated
  using (public.has_task_capability(id, 'manage'));

drop policy if exists task_dependency_read on public.task_dependency;
create policy task_dependency_read on public.task_dependency for select to authenticated
  using (
    public.has_task_capability(blocking_task_id, 'read')
    and public.has_task_capability(blocked_task_id, 'read')
  );
drop policy if exists task_dependency_staff_write on public.task_dependency;
create policy task_dependency_scoped_insert
  on public.task_dependency for insert to authenticated
  with check (
    public.has_task_capability(blocking_task_id, 'manage')
    and public.has_task_capability(blocked_task_id, 'manage')
  );
create policy task_dependency_scoped_delete
  on public.task_dependency for delete to authenticated
  using (
    public.has_task_capability(blocking_task_id, 'manage')
    and public.has_task_capability(blocked_task_id, 'manage')
  );

drop policy if exists checklist_read on public.checklist_item;
create policy checklist_read on public.checklist_item for select to authenticated
  using (public.has_task_capability(task_id, 'read'));
drop policy if exists checklist_insert on public.checklist_item;
create policy checklist_insert on public.checklist_item for insert to authenticated
  with check (
    public.has_task_capability(task_id, 'manage')
    or public.has_task_capability(task_id, 'collaborate')
  );
drop policy if exists checklist_update on public.checklist_item;
create policy checklist_update on public.checklist_item for update to authenticated
  using (
    public.has_task_capability(task_id, 'manage')
    or public.has_task_capability(task_id, 'collaborate')
  )
  with check (
    public.has_task_capability(task_id, 'manage')
    or public.has_task_capability(task_id, 'collaborate')
  );
drop policy if exists checklist_delete on public.checklist_item;
create policy checklist_delete on public.checklist_item for delete to authenticated
  using (
    public.has_task_capability(task_id, 'manage')
    or public.has_task_capability(task_id, 'collaborate')
  );

drop policy if exists task_label_read on public.task_label;
create policy task_label_read on public.task_label for select to authenticated
  using (public.has_task_capability(task_id, 'read'));
drop policy if exists task_label_insert on public.task_label;
create policy task_label_insert on public.task_label for insert to authenticated
  with check (
    public.has_task_capability(task_id, 'manage')
    or public.has_task_capability(task_id, 'collaborate')
  );
drop policy if exists task_label_delete on public.task_label;
create policy task_label_delete on public.task_label for delete to authenticated
  using (
    public.has_task_capability(task_id, 'manage')
    or public.has_task_capability(task_id, 'collaborate')
  );

drop policy if exists task_comment_read on public.task_comment;
create policy task_comment_read on public.task_comment for select to authenticated
  using (public.has_task_capability(task_id, 'read'));
drop policy if exists task_comment_insert on public.task_comment;
create policy task_comment_insert on public.task_comment for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      public.has_task_capability(task_id, 'manage')
      or public.has_task_capability(task_id, 'collaborate')
      or public.has_task_capability(task_id, 'review')
      or public.has_task_capability(task_id, 'approve')
    )
  );
drop policy if exists task_comment_author_update on public.task_comment;
create policy task_comment_author_update on public.task_comment for update to authenticated
  using (
    author_id = (select auth.uid())
    and (
      public.has_task_capability(task_id, 'manage')
      or public.has_task_capability(task_id, 'collaborate')
      or public.has_task_capability(task_id, 'review')
      or public.has_task_capability(task_id, 'approve')
    )
  )
  with check (
    author_id = (select auth.uid())
    and (
      public.has_task_capability(task_id, 'manage')
      or public.has_task_capability(task_id, 'collaborate')
      or public.has_task_capability(task_id, 'review')
      or public.has_task_capability(task_id, 'approve')
    )
  );

drop policy if exists status_update_read on public.project_status_update;
create policy status_update_read on public.project_status_update for select to authenticated
  using (public.has_project_capability(project_id, 'read'));
drop policy if exists status_update_staff_insert on public.project_status_update;
create policy status_update_scoped_insert
  on public.project_status_update for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.has_project_capability(project_id, 'manage')
  );

comment on function app.has_task_capability(uuid, text) is
  'Core scoped task predicate used by RLS. Active membership is always rechecked.';
