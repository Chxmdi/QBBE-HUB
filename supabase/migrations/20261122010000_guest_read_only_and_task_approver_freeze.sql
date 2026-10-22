-- Guests are read-only; task contributors cannot name themselves approver.
--
-- The project, program and task capability checks capped leadership viewers
-- (and owners or admins without MFA) at read-only, but not guests, so a guest
-- holding a project or program grant (or a staff member moved down to guest,
-- whose grants stay) could rename and close projects, edit tasks and
-- documents. Administrators could also give a guest any grant. Separately, a
-- task contributor could set the task's approver to themselves, and complete
-- a task waiting for its approver, since only the reviewer was checked.
--
-- Now a guest can only read and follow (in both access models), except in
-- their own private space and on their own personal tasks. Administrators
-- can give a guest only read or follow access. Contributors cannot change a
-- task's approver, blocker or series (its source is already kept by its own
-- trigger), and a task with a reviewer or approver (directly or through an
-- assignment) is completed only through review. Owning a document or
-- organizing a meeting no longer gives a guest edit rights. Grants a guest
-- already holds stay in place but give nothing beyond read and follow.

CREATE OR REPLACE FUNCTION app.has_project_capability(p_project uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.project p
    join public.organization_membership m
      on m.organization_id = p.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where p.id = p_project
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
      -- A guest is read-only, whatever their grants say.
      and not (
        m.role = 'guest'
        and lower(p_capability) not in ('read', 'follow')
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
        or p.owner_id = (select auth.uid())
           and app.project_role_has_capability('project_manager', p_capability)
        or exists (
          select 1 from public.project_access_grant g
          where g.project_id = p.id
            and g.organization_id = p.organization_id
            and g.user_id = (select auth.uid())
            and app.project_role_has_capability(g.role, p_capability)
        )
        or exists (
          select 1 from public.program_access_grant g
          where p.program_id is not null
            and g.program_id = p.program_id
            and g.organization_id = p.organization_id
            and g.user_id = (select auth.uid())
            and app.project_role_has_capability(
              app.project_role_for_program_role(g.role), p_capability
            )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION app.has_program_capability(p_program uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.program p
    join public.organization_membership m
      on m.organization_id = p.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where p.id = p_program
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
      -- A guest is read-only, whatever their grants say.
      and not (
        m.role = 'guest'
        and lower(p_capability) not in ('read', 'follow')
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
        or p.lead_id = (select auth.uid())
           and app.program_role_has_capability('lead', p_capability)
        or exists (
          select 1 from public.program_access_grant g
          where g.program_id = p.id
            and g.organization_id = p.organization_id
            and g.user_id = (select auth.uid())
            and app.program_role_has_capability(g.role, p_capability)
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION app.has_task_capability(p_task uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- A guest is read-only, whatever their grants or assignments say,
      -- except on their own personal tasks (on no project or program, in
      -- their private space).
      and not (
        m.role = 'guest'
        and lower(p_capability) not in ('read', 'follow')
        and not (t.project_id is null and t.program_id is null
                 and t.created_by = (select auth.uid()))
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
          t.project_id is null and t.program_id is null
          and t.created_by = (select auth.uid())
          and lower(p_capability) in ('read', 'manage', 'collaborate', 'follow')
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
        or (
          t.approver_id = (select auth.uid())
          and lower(p_capability) in ('read', 'review', 'approve')
        )
        or exists (
          select 1
          from public.task_assignment ta
          where ta.task_id = t.id
            and ta.user_id = (select auth.uid())
            and lower(p_capability) = any (
              case ta.role
                when 'contributor' then array['read', 'collaborate']
                when 'reviewer' then array['read', 'review']
                when 'approver' then array['read', 'review', 'approve']
                when 'follower' then array['read', 'follow']
                else array[]::text[]
              end
            )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_project_direct_access(p_project uuid, p_user uuid, p_role project_access_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_role not in ('read_only', 'follower') and exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_organization
      and m.user_id = p_user and m.status = 'active' and m.role = 'guest'
  ) then
    raise exception 'A guest can only be given read or follow access.'
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
$function$;

CREATE OR REPLACE FUNCTION public.set_program_direct_access(p_program uuid, p_user uuid, p_role program_access_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_role not in ('read_only', 'follower') and exists (
    select 1 from public.organization_membership m
    where m.organization_id = v_organization
      and m.user_id = p_user and m.status = 'active' and m.role = 'guest'
  ) then
    raise exception 'A guest can only be given read or follow access.'
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
$function$;

CREATE OR REPLACE FUNCTION app.enforce_scoped_task_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or new.recurrence_parent_id is distinct from old.recurrence_parent_id
      or new.approver_id is distinct from old.approver_id
      or new.blocked_by_id is distinct from old.blocked_by_id
      or new.series_id is distinct from old.series_id then
      raise exception 'Contributors cannot change task authority or operational context.'
        using errcode = '42501';
    end if;
    if (old.reviewer_id is not null or old.approver_id is not null
        or exists (select 1 from public.task_assignment ta
                   where ta.task_id = old.id and ta.role in ('reviewer', 'approver')))
      and new.status = 'completed' and old.status <> 'completed' then
      raise exception 'A task with a reviewer or approver must be decided through review.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Task update is outside the actor''s scoped capability.'
    using errcode = '42501';
end;
$function$;

-- The organization-wide access model applies roles in one place; a guest's
-- bits are capped at read and follow there too, so the two models agree.
create or replace function app.access_finish_bits(
  p_role public.org_role, p_aal2 boolean, p_in_private boolean, p_archived boolean, p_grant_bits integer
)
returns integer
language sql immutable parallel safe
set search_path = ''
as $$
  select (
    (coalesce(p_grant_bits, 0)
      | case
          when p_in_private then 0
          when p_role in ('owner', 'admin') then case when p_aal2 then 2047 else 1 end
          when p_role = 'leadership_viewer' then 1
          else 0
        end)
    & case
        when p_role in ('owner', 'admin') and not p_aal2 then 1
        when p_role = 'leadership_viewer' then 1
        when p_role = 'guest' and not p_in_private then 1 | 1024
        else 2047
      end
    & case when p_archived then 1 | 16 else 2047 end
  )::integer;
$$;

revoke all on function app.access_finish_bits(public.org_role, boolean, boolean, boolean, integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.can_manage_document(p_document uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.document d
    where d.id = p_document
      and (
        app.is_org_admin(d.organization_id)
        -- Owning a document does not make a read-only guest its editor.
        or (
          d.owner_id = (select auth.uid())
          and not exists (
            select 1 from public.organization_membership m
            where m.organization_id = d.organization_id
              and m.user_id = (select auth.uid())
              and m.status = 'active'
              and m.role = 'guest'
          )
        )
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
$function$;

CREATE OR REPLACE FUNCTION app.can_manage_meeting(p_meeting uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- Organizing a meeting does not make a read-only guest its manager.
      and mem.role <> 'guest'
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
$function$;

revoke all on function app.can_manage_document(uuid) from public, anon;
grant execute on function app.can_manage_document(uuid) to authenticated, service_role;
revoke all on function app.can_manage_meeting(uuid) from public, anon;
grant execute on function app.can_manage_meeting(uuid) to authenticated, service_role;

revoke all on function app.has_project_capability(uuid, text) from public, anon;
grant execute on function app.has_project_capability(uuid, text) to authenticated, service_role;
revoke all on function app.has_program_capability(uuid, text) from public, anon;
grant execute on function app.has_program_capability(uuid, text) to authenticated, service_role;
revoke all on function app.has_task_capability(uuid, text) from public, anon;
grant execute on function app.has_task_capability(uuid, text) to authenticated, service_role;
revoke all on function public.set_project_direct_access(uuid, uuid, public.project_access_role) from public, anon;
grant execute on function public.set_project_direct_access(uuid, uuid, public.project_access_role) to authenticated;
revoke all on function public.set_program_direct_access(uuid, uuid, public.program_access_role) from public, anon;
grant execute on function public.set_program_direct_access(uuid, uuid, public.program_access_role) to authenticated;
revoke all on function app.enforce_scoped_task_update() from public, anon, authenticated;
