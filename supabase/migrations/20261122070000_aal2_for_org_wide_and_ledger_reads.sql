-- Reading without a second factor.
--
-- Owners and administrators who signed in with a password only could read
-- organization-wide data (every project, program, task, meeting, event and
-- report) straight from the database: the read helpers gave their role the
-- leadership reach without checking MFA, and the access model gave them
-- view on every node. MFA blocked only writes and admin tables. Staff
-- named as ledger readers read payroll and gifts without MFA, while the
-- outside accountant with the same access had to use it.
--
-- Now an owner or administrator without a completed MFA sign-in reads like
-- a member (through their own grants), and ledger readers need MFA too.
-- Leadership viewers are unchanged.

-- A session that completed MFA keeps its aal2 token until it refreshes,
-- even after its last authenticator was removed. The organization-wide
-- reach above follows app.is_org_admin and needs a verified authenticator
-- too; the capability checks and the access model now ask the same.
create or replace function app.session_has_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    and exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.factor_type = 'totp' and f.status = 'verified'
    );
$$;

revoke all on function app.session_has_mfa() from public, anon;
grant execute on function app.session_has_mfa() to authenticated, service_role;

CREATE OR REPLACE FUNCTION app.can_read_event(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.event e
    join public.organization_membership mem
      on mem.organization_id = e.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where e.id = p_event
      and (
        (mem.role = 'leadership_viewer' or (mem.role in ('owner', 'admin') and app.is_org_admin(mem.organization_id)))
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
$function$;

CREATE OR REPLACE FUNCTION app.can_read_meeting(p_meeting uuid)
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
      and (
        (mem.role = 'leadership_viewer' or (mem.role in ('owner', 'admin') and app.is_org_admin(mem.organization_id)))
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
$function$;

CREATE OR REPLACE FUNCTION app.can_read_report(p_report uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.report_instance r
    join public.organization_membership mem
      on mem.organization_id = r.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    where r.id = p_report
      and (
        (mem.role = 'leadership_viewer' or (mem.role in ('owner', 'admin') and app.is_org_admin(mem.organization_id)))
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
$function$;

CREATE OR REPLACE FUNCTION app.task_read_organization_wide()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(m.organization_id), '{}')
  from public.organization_membership m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and (m.role = 'leadership_viewer'
         or (m.role in ('owner', 'admin') and app.is_org_admin(m.organization_id)));
$function$;

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
        and not app.session_has_mfa()
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
        -- Organization-wide reach needs a completed MFA sign-in.
        (
          m.role in ('owner', 'admin')
          and app.session_has_mfa()
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
        and not app.session_has_mfa()
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
        -- Organization-wide reach needs a completed MFA sign-in.
        (
          m.role in ('owner', 'admin')
          and app.session_has_mfa()
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
        and not app.session_has_mfa()
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
        -- Organization-wide reach needs a completed MFA sign-in.
        (
          m.role in ('owner', 'admin')
          and app.session_has_mfa()
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

CREATE OR REPLACE FUNCTION app.access_finish_bits(p_role org_role, p_aal2 boolean, p_in_private boolean, p_archived boolean, p_grant_bits integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select (
    (coalesce(p_grant_bits, 0)
      | case
          when p_in_private then 0
          when p_role in ('owner', 'admin') then case when p_aal2 then 2047 else 0 end
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
$function$;

CREATE OR REPLACE FUNCTION app.can_read_ledger(p_organization uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.is_org_admin(p_organization)
    or (
      app.is_org_staff(p_organization)
      -- Payroll and gifts, like the outside accountant: MFA first.
      and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      and exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.factor_type = 'totp' and f.status = 'verified'
      )
      and exists (
        select 1 from public.ledger_reader r
        where r.organization_id = p_organization and r.user_id = auth.uid()
      )
    )
    or app.is_ledger_accountant(p_organization);
$function$;

revoke all on function app.can_read_event(uuid) from public, anon;
grant execute on function app.can_read_event(uuid) to authenticated, service_role;
revoke all on function app.can_read_meeting(uuid) from public, anon;
grant execute on function app.can_read_meeting(uuid) to authenticated, service_role;
revoke all on function app.can_read_report(uuid) from public, anon;
grant execute on function app.can_read_report(uuid) to authenticated, service_role;
revoke all on function app.task_read_organization_wide() from public, anon;
grant execute on function app.task_read_organization_wide() to authenticated, service_role;
revoke all on function app.has_project_capability(uuid, text) from public, anon;
grant execute on function app.has_project_capability(uuid, text) to authenticated, service_role;
revoke all on function app.has_program_capability(uuid, text) from public, anon;
grant execute on function app.has_program_capability(uuid, text) to authenticated, service_role;
revoke all on function app.has_task_capability(uuid, text) from public, anon;
grant execute on function app.has_task_capability(uuid, text) to authenticated, service_role;
revoke all on function app.access_finish_bits(public.org_role, boolean, boolean, boolean, integer) from public, anon, authenticated;
revoke all on function app.can_read_ledger(uuid) from public, anon;
grant execute on function app.can_read_ledger(uuid) to authenticated, service_role;

-- The access model gave the creator of a task on no project or program
-- nothing (owners and administrators read it through their role, which
-- now needs MFA); today's rules let the creator read, manage, collaborate
-- on and follow it.
insert into public.access_role (organization_id, key, name_en, name_fr, caps, builtin)
values (null, 'task_creator', 'Task creator', 'Créateur de la tâche', 1|2|4|8|16|32|64|512|1024, true)
on conflict do nothing;

CREATE OR REPLACE FUNCTION app.access_sync_tasks(p_tasks uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_missing uuid;
begin
  for v_missing in
    select distinct t.project_id from public.task t
    where t.id = any (p_tasks) and t.project_id is not null
      and not exists (select 1 from app.access_node n where n.id = t.project_id)
  loop
    perform app.access_ensure_project(v_missing);
  end loop;
  for v_missing in
    select distinct t.program_id from public.task t
    where t.id = any (p_tasks) and t.project_id is null and t.program_id is not null
      and not exists (select 1 from app.access_node n where n.id = t.program_id)
  loop
    perform app.access_ensure_program(v_missing);
  end loop;

  -- Tasks that moved (or have pages under them) go one at a time so their
  -- descendants are rewritten; new and unmoved tasks go in one statement.
  perform app.access_put_node(t.id, t.organization_id, 'task', null, coalesce(t.project_id, t.program_id))
  from public.task t
  join app.access_node n on n.id = t.id
  where t.id = any (p_tasks)
    and n.parent_id is distinct from coalesce(t.project_id, t.program_id);

  insert into app.access_node (id, organization_id, kind, parent_id, ancestors, in_private)
  select t.id, t.organization_id, 'task', p.id,
         case when p.id is null then array[t.id] else array[t.id] || p.ancestors end,
         coalesce(p.in_private, false)
  from public.task t
  left join app.access_node p
    on p.id = coalesce(t.project_id, t.program_id) and p.organization_id = t.organization_id
  where t.id = any (p_tasks)
  on conflict (id) do nothing;

  delete from public.access_grant g
  where g.object_id = any (p_tasks)
    and g.source in ('task.assignee_id', 'task.requester_id', 'task.reviewer_id', 'task.approver_id', 'task.created_by');

  insert into public.access_grant
    (organization_id, object_id, principal_kind, user_id, role_id, source, legacy_id, created_by)
  select t.organization_id, t.id, 'person', c.user_id, app.builtin_role(c.role_key), c.source, t.id, null
  from public.task t
  cross join lateral (values
    (t.assignee_id, 'task_contributor', 'task.assignee_id'),
    (t.requester_id, 'task_contributor', 'task.requester_id'),
    (t.reviewer_id, 'task_approver', 'task.reviewer_id'),
    (t.approver_id, 'task_approver', 'task.approver_id'),
    -- The creator of a task on no project or program manages it.
    (case when t.project_id is null and t.program_id is null then t.created_by end, 'task_creator', 'task.created_by')
  ) as c (user_id, role_key, source)
  where t.id = any (p_tasks) and c.user_id is not null
  on conflict do nothing;
end;
$function$;

select app.access_sync_tasks(array(
  select t.id from public.task t where t.project_id is null and t.program_id is null and t.created_by is not null));
revoke all on function app.access_sync_tasks(uuid[]) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.access_bits(p_node uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select app.access_finish_bits(
      m.role,
      app.session_has_mfa(),
      n.in_private, n.archived, c.caps)
    from app.access_node n
    join public.organization_membership m
      on m.organization_id = n.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    left join app.access_cache c on c.user_id = m.user_id and c.object_id = n.id
    where n.id = p_node
  ), 0);
$function$;

CREATE OR REPLACE FUNCTION app.access_orgs_where(p_capability text)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(m.organization_id), '{}')
  from public.organization_membership m
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and app.access_finish_bits(m.role, app.session_has_mfa(), false, false, 0)
        & app.cap_bit(p_capability) <> 0
    and app.cap_bit(p_capability) <> 0;
$function$;

CREATE OR REPLACE FUNCTION app.access_cached_ids(p_capability text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.object_id
  from app.access_cache c
  join public.organization_membership m
    on m.organization_id = c.organization_id and m.user_id = c.user_id and m.status = 'active'
  join app.access_node n on n.id = c.object_id
  where c.user_id = (select auth.uid())
    and app.cap_bit(p_capability) <> 0
    and app.access_finish_bits(m.role, app.session_has_mfa(),
          n.in_private, n.archived, c.caps) & app.cap_bit(p_capability) <> 0;
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
        and not app.session_has_mfa()
      )
      -- Organizing a meeting does not make a read-only guest its manager.
      and mem.role <> 'guest'
      and (
        (mem.role in ('owner', 'admin') and app.session_has_mfa())
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

CREATE OR REPLACE FUNCTION app.can_manage_event(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        and not app.session_has_mfa()
      )
      and (
        (mem.role in ('owner', 'admin') and app.session_has_mfa())
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
$function$;

revoke all on function app.access_bits(uuid) from public, anon;
grant execute on function app.access_bits(uuid) to authenticated, service_role;
revoke all on function app.access_orgs_where(text) from public, anon;
grant execute on function app.access_orgs_where(text) to authenticated, service_role;
revoke all on function app.access_cached_ids(text) from public, anon;
grant execute on function app.access_cached_ids(text) to authenticated, service_role;
revoke all on function app.can_manage_meeting(uuid) from public, anon;
grant execute on function app.can_manage_meeting(uuid) to authenticated, service_role;
revoke all on function app.can_manage_event(uuid) from public, anon;
grant execute on function app.can_manage_event(uuid) to authenticated, service_role;

-- Background job runs are an admin table: MFA, as the others.
drop policy if exists background_job_run_admin_read on public.background_job_run;
create policy background_job_run_admin_read on public.background_job_run
  for select to authenticated
  using (app.is_org_admin(organization_id));
