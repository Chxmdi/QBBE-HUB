-- QBBE Hub — milestone dependencies and recurring series (#31, P1-TSK-09/11).
--
-- Two gaps in advanced task planning, both of which have to be closed in the
-- data rather than in a command, because both are races that a command cannot
-- win on its own.
--
--   1. **Milestones cannot depend on milestones.** `task_dependency` has had a
--      whole-graph cycle guard since `20260908045748`. Milestones have had
--      nothing: the product can order them by `sort_key` and can say a task
--      blocks a task, but "the venue must be booked before invitations go out"
--      has had nowhere to live. P1-TSK-09 names both records, so a task-only
--      implementation satisfies half a requirement.
--
--   2. **Recurrence has a chain but no series.** `20260905062624` added
--      `recurrence_parent_id` and guaranteed one successor per occurrence,
--      and said plainly in its own comment that this "does not create" a
--      series entity. Without one there is no owner of the recurrence, no way
--      to stop a series without hunting down its live occurrence, and no way
--      to tell an occurrence someone deliberately edited from one that still
--      tracks the series. P1-TSK-11 asks for exactly those three things.
--
-- What is deliberately NOT here: the rule that a blocked record cannot be
-- completed before the record blocking it. Dependencies in this product are
-- advisory — they surface a blocker, they do not refuse the work — and the
-- task side has behaved that way since it shipped. Making the milestone side
-- refuse would give one requirement two different meanings depending on which
-- record you were looking at.

-- ---------------------------------------------------------------------------
-- 1. Milestone dependencies
-- ---------------------------------------------------------------------------

create table if not exists public.milestone_dependency (
  blocking_milestone_id uuid not null references public.milestone (id) on delete cascade,
  blocked_milestone_id  uuid not null references public.milestone (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocking_milestone_id, blocked_milestone_id),
  constraint no_self_milestone_dependency
    check (blocking_milestone_id <> blocked_milestone_id)
);

-- Read the edge only if both ends are readable. A one-sided read would let
-- someone infer the existence and identity of a milestone in a project they
-- cannot open, which is the same disclosure `task_dependency_read` avoids.
alter table public.milestone_dependency enable row level security;

create policy milestone_dependency_read on public.milestone_dependency
  for select to authenticated
  using (
    public.has_project_capability(
      (select m.project_id from public.milestone m where m.id = blocking_milestone_id), 'read')
    and public.has_project_capability(
      (select m.project_id from public.milestone m where m.id = blocked_milestone_id), 'read')
  );

create policy milestone_dependency_insert on public.milestone_dependency
  for insert to authenticated
  with check (
    public.has_project_capability(
      (select m.project_id from public.milestone m where m.id = blocking_milestone_id), 'manage')
    and public.has_project_capability(
      (select m.project_id from public.milestone m where m.id = blocked_milestone_id), 'manage')
  );

create policy milestone_dependency_delete on public.milestone_dependency
  for delete to authenticated
  using (
    public.has_project_capability(
      (select m.project_id from public.milestone m where m.id = blocking_milestone_id), 'manage')
    and public.has_project_capability(
      (select m.project_id from public.milestone m where m.id = blocked_milestone_id), 'manage')
  );

-- The cycle guard, deliberately a copy of the task one rather than a shared
-- generic. A single polymorphic walker would need the edge table name as a
-- parameter and therefore dynamic SQL inside a security definer function,
-- which is a far worse thing to own than twenty duplicated lines.
--
-- The advisory lock is what makes this correct under concurrency. Two
-- transactions can each walk a graph that has no cycle, and each insert an
-- edge that only creates one in combination with the other's. Serializing the
-- check closes that window; the number is this function's own, distinct from
-- the task guard's 727204018 so the two never block each other.
create or replace function app.reject_milestone_dependency_cycle()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(727204019);
  if new.blocking_milestone_id = new.blocked_milestone_id or exists (
    with recursive reachable(id) as (
      select new.blocked_milestone_id
      union
      select d.blocked_milestone_id
      from public.milestone_dependency d
      join reachable r on d.blocking_milestone_id = r.id
    )
    select 1 from reachable where id = new.blocking_milestone_id
  ) then
    raise exception 'That dependency would create a cycle.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.reject_milestone_dependency_cycle() from public, anon, authenticated;

drop trigger if exists milestone_dependency_no_cycles on public.milestone_dependency;
create trigger milestone_dependency_no_cycles
  before insert or update on public.milestone_dependency
  for each row execute function app.reject_milestone_dependency_cycle();

create index if not exists idx_milestone_dependency_blocked
  on public.milestone_dependency (blocked_milestone_id);

-- ---------------------------------------------------------------------------
-- 2. Task series
-- ---------------------------------------------------------------------------
--
-- A series is the recurrence itself: the rule, the anchor it counts from, and
-- the person answerable for it. Occurrences point at it. This is additive —
-- `recurrence_rule`, `recurrence_anchor` and `recurrence_parent_id` stay on
-- `task` and keep working — because every existing recurring task predates
-- this table and must not stop recurring the moment it is applied.

create table if not exists public.task_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  project_id uuid references public.project (id) on delete cascade,
  title text not null,
  recurrence_rule text not null check (recurrence_rule in ('weekly', 'monthly')),
  recurrence_anchor date not null,
  -- The series owner. P1-TSK-11 asks for "a clear series owner", which is not
  -- the same person as the assignee of any one occurrence: whoever is on this
  -- week's copy may change, while somebody stays answerable for the fact that
  -- the thing recurs at all.
  owner_id uuid not null references public.user_profile (id),
  -- Ending a series must not delete its history. A stopped series keeps every
  -- occurrence it already produced and simply stops producing more, so this is
  -- a timestamp rather than a delete.
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.task_series enable row level security;

-- A series with no project is organization-wide operational work, so it falls
-- back to organization membership. A series attached to a project follows that
-- project's capabilities, exactly as its occurrences do.
create policy task_series_read on public.task_series
  for select to authenticated
  using (
    case when project_id is null
      then organization_id in (
        select m.organization_id from public.organization_membership m
        where m.user_id = (select auth.uid()) and m.status = 'active')
      else public.has_project_capability(project_id, 'read')
    end
  );

create policy task_series_write on public.task_series
  for all to authenticated
  using (
    case when project_id is null
      then organization_id in (
        select m.organization_id from public.organization_membership m
        where m.user_id = (select auth.uid()) and m.status = 'active'
          and m.role in ('owner', 'admin', 'staff'))
      else public.has_project_capability(project_id, 'manage')
    end
  )
  with check (
    case when project_id is null
      then organization_id in (
        select m.organization_id from public.organization_membership m
        where m.user_id = (select auth.uid()) and m.status = 'active'
          and m.role in ('owner', 'admin', 'staff'))
      else public.has_project_capability(project_id, 'manage')
    end
  );

alter table public.task
  add column if not exists series_id uuid references public.task_series (id) on delete set null;

-- Which occurrence this is. Two rows in one series must not claim the same
-- date: that is the duplicate-successor failure of `20260905062624` seen from
-- the series side, and it is the one this table can state directly rather than
-- inferring from a chain of parent pointers.
alter table public.task
  add column if not exists occurrence_date date;

-- Set when somebody edits this occurrence away from what the series would have
-- produced. P1-TSK-11 calls for "safe handling of edited occurrences", and the
-- only way to leave an edit alone is to know it happened; a regenerating job
-- must be able to tell a copy it may overwrite from one a person changed.
alter table public.task
  add column if not exists series_edited_at timestamptz;

create unique index if not exists uq_one_task_per_series_occurrence
  on public.task (series_id, occurrence_date)
  where series_id is not null and occurrence_date is not null;

create index if not exists idx_task_series on public.task (series_id)
  where series_id is not null;

-- An occurrence date without a series is meaningless, and a series membership
-- without a date cannot be deduplicated by the index above. Require both or
-- neither so no row can sit in the gap the unique index does not cover.
alter table public.task drop constraint if exists task_series_occurrence_paired;
alter table public.task
  add constraint task_series_occurrence_paired
  check ((series_id is null) = (occurrence_date is null)) not valid;

grant select, insert, update, delete on public.milestone_dependency to authenticated;
grant select, insert, update, delete on public.task_series to authenticated;
