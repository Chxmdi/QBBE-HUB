-- Task roles were persistable but not authoritative.
--
-- `20260912040000_prd_workstream_completion` added `task.approver_id` and the
-- `task_assignment` table (contributor / reviewer / approver / follower), but
-- `app.has_task_capability` was never taught about either. The effect was that
-- naming somebody a reviewer, approver, contributor or follower granted them
-- nothing: unless they already reached the task through its project or program,
-- every policy that asks the capability helper denied them, so the task was
-- invisible to the one person who had just been made responsible for it.
--
-- That is why a review queue cannot be built on those roles until this lands
-- (P0-TSK-02, P0-TSK-06), and why it is an authorization defect rather than a
-- presentation one (P0-AUTH-02).
--
-- The capability mapping mirrors `src/lib/access-capabilities.ts` so the
-- database and the application agree by construction:
--
--   contributor -> read, collaborate
--   reviewer    -> read, review
--   approver    -> read, review, approve
--   follower    -> read, follow
--   approver_id -> read, review, approve   (column form of the same role)
--
-- Unchanged: the owner/admin AAL2 requirement for every non-read capability,
-- leadership_viewer's read-only ceiling, and same-organization active
-- membership as the precondition for all of it.

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
$$;

revoke all on function app.has_task_capability(uuid, text)
  from public, anon, authenticated;
grant execute on function app.has_task_capability(uuid, text)
  to service_role;

comment on function app.has_task_capability(uuid, text) is
  'Authoritative task capability predicate. Grants flow from organization role '
  '(with the AAL2 requirement on writes), inherited project/program capability, '
  'the task actor columns, and explicit task_assignment roles.';

-- `task_assignment`''s primary key is (task_id, user_id, role), so "which tasks
-- am I a reviewer on" had no usable index. My Work asks exactly that on every
-- render, and the capability helper now asks it inside every task policy.
create index if not exists idx_task_assignment_user
  on public.task_assignment (user_id, role);

-- A person must be able to see the row that names them, independently of the
-- capability helper. Without this, reading your own assignment required already
-- being able to read the task, which is the circularity that made the roles
-- undiscoverable: the grant could not explain itself.
drop policy if exists task_assignment_self_read on public.task_assignment;
create policy task_assignment_self_read on public.task_assignment
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Same-organization integrity had the same blind spot as the capability helper.
-- `app.validate_task_scope_write` checks that the assignee, requester and
-- reviewer are active members of the task's organization, but `approver_id` was
-- added later and never added here, so a task could name an approver from
-- another organization. The body below is the existing one plus that check.
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

  if (tg_op = 'INSERT' or new.approver_id is distinct from old.approver_id)
    and new.approver_id is not null and not exists (
      select 1 from public.organization_membership m
      where m.organization_id = new.organization_id
        and m.user_id = new.approver_id and m.status = 'active'
    ) then
    raise exception 'Task approver must be an active member of the same organization.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- `task_assignment` now confers capability, which makes it an access-granting
-- table. Nothing stopped a row naming somebody outside the task's organization,
-- and such a row would have been a cross-organization grant.
create or replace function app.validate_task_assignment_scope()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.task t
    join public.organization_membership m
      on m.organization_id = t.organization_id
     and m.user_id = new.user_id
     and m.status = 'active'
    where t.id = new.task_id
  ) then
    raise exception 'A task role requires an active member of the task''s organization.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_task_assignment_scope on public.task_assignment;
create trigger validate_task_assignment_scope
  before insert or update on public.task_assignment
  for each row execute function app.validate_task_assignment_scope();
