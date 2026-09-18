-- P0-TSK-04 lets a blocked task name the person needed to unblock it, and
-- P0-TSK-05 requires the resulting history to be legible to the people
-- accountable for the work. Both were missing a piece.

-- A blocked task could record free text and a blocking task (task_dependency),
-- but not the person whose action is required. That person is usually the whole
-- answer to "what is this waiting on".
alter table public.task
  add column if not exists blocked_by_id uuid references public.user_profile (id);

comment on column public.task.blocked_by_id is
  'Optional person whose action is needed to unblock the task (P0-TSK-04). '
  'Complements blocked_reason and task_dependency; none of the three is implied '
  'by the others.';

-- Same-organization integrity, as a small dedicated trigger rather than another
-- copy of app.validate_task_scope_write. The column is independent of the scope
-- fields that function exists to reconcile, and duplicating ninety lines to add
-- four is how the approver_id check came to be missing in the first place.
create or replace function app.validate_task_blocker_scope()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.blocked_by_id is not null and not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id
      and m.user_id = new.blocked_by_id
      and m.status = 'active'
  ) then
    raise exception 'A blocking person must be an active member of the same organization.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_task_blocker_scope on public.task;
create trigger validate_task_blocker_scope
  before insert or update on public.task
  for each row execute function app.validate_task_blocker_scope();

-- Task history was readable only through project/program capability. Somebody
-- who reaches a task through a task role — its assignee, reviewer, approver or
-- an explicit task_assignment — could open the task and see no history at all,
-- because every one of its activity rows was filtered out.
--
-- This widens the policy by exactly one case: a task-sourced row is readable by
-- whoever can already read that task. It grants nothing that reading the task
-- did not already grant.
--
-- The policy is evaluated as the querying role, so that role needs execute on
-- the helper it calls. The program and project helpers were granted long ago;
-- the task helper never was, because until now no policy the client reads
-- through called it by that name. Without this grant every authenticated read
-- of activity_event fails outright.
grant execute on function app.has_task_capability(uuid, text) to authenticated;

drop policy if exists activity_read on public.activity_event;
create policy activity_read on public.activity_event for select to authenticated
  using (
    (project_id is not null and app.has_project_capability(project_id, 'read'))
    or (
      project_id is null and program_id is not null
      and app.has_program_capability(program_id, 'read')
    )
    or (
      source_type = 'task'
      and app.has_task_capability(source_id, 'read')
    )
    or (
      project_id is null and program_id is null
      and app.is_org_member(organization_id)
    )
  );
