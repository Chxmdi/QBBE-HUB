-- Workspace OS V1-11: goals (stream S5b, epic #199).
--
-- A goal links projects and outcome metrics (`outcome_metric`). Its progress
-- is never typed in: it is worked out on every read from the linked metrics'
-- latest measurements and the linked projects' completion, so it moves by
-- itself as work gets done and numbers get recorded.
--
-- Access:
--   read    an organization-wide goal (no program): any active member, like
--           outcome_metric; a program goal: whoever can read the program
--   manage  an administrator, or whoever manages the goal's program
--   link    manage the goal, and be able to read the project being linked
--           (metrics are readable by every member already)
--
-- Hidden behind the `wos_goals` switch (20261105110000_s5b_feature_switches).

create table public.goal (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  program_id uuid references public.program (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  owner_id uuid references public.user_profile (id) on delete set null,
  target_on date,
  status text not null default 'active' check (status in ('active', 'achieved', 'dropped')),
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_goal_org on public.goal (organization_id, status, created_at desc);
create index idx_goal_program on public.goal (program_id) where program_id is not null;

create table public.goal_project (
  goal_id uuid not null references public.goal (id) on delete cascade,
  project_id uuid not null references public.project (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (goal_id, project_id)
);
create index idx_goal_project_project on public.goal_project (project_id);

create table public.goal_metric (
  goal_id uuid not null references public.goal (id) on delete cascade,
  metric_id uuid not null references public.outcome_metric (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (goal_id, metric_id)
);
create index idx_goal_metric_metric on public.goal_metric (metric_id);

comment on table public.goal is
  'A goal (Workspace OS V1-11). Progress is computed from linked outcome metrics and projects; see public.goal_progress_inputs.';

-- Access helpers ---------------------------------------------------------------
create or replace function app.can_read_goal(p_goal uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.goal g
    where g.id = p_goal
      and app.is_org_member(g.organization_id)
      and (
        g.program_id is null
        or app.has_program_capability(g.program_id, 'read')
        or app.is_org_admin(g.organization_id)
      )
  );
$$;

create or replace function app.can_manage_goal(p_goal uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.goal g
    where g.id = p_goal
      and (
        app.is_org_admin(g.organization_id)
        or (g.program_id is not null and app.has_program_capability(g.program_id, 'manage'))
      )
  );
$$;

revoke all on function app.can_read_goal(uuid), app.can_manage_goal(uuid) from public, anon;
grant execute on function app.can_read_goal(uuid), app.can_manage_goal(uuid) to authenticated, service_role;

create or replace function public.can_manage_goal(p_goal uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_goal(p_goal);
$$;
revoke all on function public.can_manage_goal(uuid) from public, anon;
grant execute on function public.can_manage_goal(uuid) to authenticated, service_role;

-- Guards: organization always comes from the parent row -----------------------
create or replace function app.goal_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.program_id is not null and not exists (
    select 1 from public.program p where p.id = new.program_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Program is not in this organization' using errcode = '23514';
  end if;
  if new.owner_id is not null and not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id and m.user_id = new.owner_id and m.status = 'active'
  ) then
    raise exception 'The owner must be an active member' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.goal_link_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_linked_org uuid;
begin
  select g.organization_id into new.organization_id from public.goal g where g.id = new.goal_id;
  if new.organization_id is null then
    raise exception 'Goal not found' using errcode = '23503';
  end if;
  if tg_table_name = 'goal_project' then
    select p.organization_id into v_linked_org from public.project p where p.id = new.project_id;
  else
    select m.organization_id into v_linked_org from public.outcome_metric m where m.id = new.metric_id;
  end if;
  if v_linked_org is distinct from new.organization_id then
    raise exception 'Only records from the same organization can be linked' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function app.goal_guard(), app.goal_link_guard() from public, anon, authenticated;

create trigger goal_guard before insert or update on public.goal
  for each row execute function app.goal_guard();
create trigger goal_project_guard before insert on public.goal_project
  for each row execute function app.goal_link_guard();
create trigger goal_metric_guard before insert on public.goal_metric
  for each row execute function app.goal_link_guard();

-- RLS ----------------------------------------------------------------------------
alter table public.goal enable row level security;
alter table public.goal_project enable row level security;
alter table public.goal_metric enable row level security;

-- Written on the row's own columns rather than app.can_read_goal(id): the
-- helper re-reads the table, which cannot see a row an INSERT ... RETURNING
-- is still writing.
create policy goal_read on public.goal for select to authenticated
  using (
    app.is_org_member(organization_id)
    and (
      program_id is null
      or app.has_program_capability(program_id, 'read')
      or app.is_org_admin(organization_id)
    )
  );
create policy goal_insert on public.goal for insert to authenticated
  with check (
    app.is_org_admin(organization_id)
    or (program_id is not null and app.has_program_capability(program_id, 'manage'))
  );
create policy goal_update on public.goal for update to authenticated
  using (app.can_manage_goal(id))
  with check (
    app.is_org_admin(organization_id)
    or (program_id is not null and app.has_program_capability(program_id, 'manage'))
  );
create policy goal_delete on public.goal for delete to authenticated
  using (app.can_manage_goal(id));

create policy goal_project_read on public.goal_project for select to authenticated
  using (app.can_read_goal(goal_id));
create policy goal_project_insert on public.goal_project for insert to authenticated
  with check (app.can_manage_goal(goal_id) and app.has_project_capability(project_id, 'read'));
create policy goal_project_delete on public.goal_project for delete to authenticated
  using (app.can_manage_goal(goal_id));

create policy goal_metric_read on public.goal_metric for select to authenticated
  using (app.can_read_goal(goal_id));
create policy goal_metric_insert on public.goal_metric for insert to authenticated
  with check (app.can_manage_goal(goal_id));
create policy goal_metric_delete on public.goal_metric for delete to authenticated
  using (app.can_manage_goal(goal_id));

revoke all on public.goal, public.goal_project, public.goal_metric from anon, authenticated;
grant select, insert, update, delete on public.goal to authenticated;
grant select, insert, delete on public.goal_project, public.goal_metric to authenticated;
grant all on public.goal, public.goal_project, public.goal_metric to service_role;

-- Progress inputs ------------------------------------------------------------------
-- One row per link, with what progress needs. Counting tasks has to see every
-- task on a linked project, not only the ones the viewer can open, or two
-- people would see two different numbers for one goal; so this is a security
-- definer function. It answers only a caller who can read the goal, and it
-- returns counts and names, never task rows. A project the caller cannot read
-- still counts but is not named.
create or replace function public.goal_progress_inputs(p_goal uuid)
returns table (
  kind text,
  ref_id uuid,
  label text,
  project_completed boolean,
  tasks_done integer,
  tasks_total integer,
  metric_direction text,
  metric_baseline numeric,
  metric_target numeric,
  metric_latest numeric,
  metric_latest_on date
)
language sql stable security definer set search_path = '' as $$
  select 'project', p.id,
    case when app.has_project_capability(p.id, 'read') then p.name else null end,
    p.stage = 'completed',
    (select count(*)::integer from public.task t
      where t.project_id = p.id and t.archived_at is null and t.status = 'completed'),
    (select count(*)::integer from public.task t
      where t.project_id = p.id and t.archived_at is null and t.status <> 'cancelled'),
    null, null, null, null, null
  from public.goal_project gp
  join public.project p on p.id = gp.project_id
  where gp.goal_id = p_goal and app.can_read_goal(p_goal)
  union all
  select 'metric', m.id, m.name, null, null, null,
    m.direction::text, m.baseline, m.target, latest.value, latest.measured_on
  from public.goal_metric gm
  join public.outcome_metric m on m.id = gm.metric_id
  left join lateral (
    select om.value, om.measured_on from public.outcome_measurement om
    where om.metric_id = m.id order by om.measured_on desc limit 1
  ) latest on true
  where gm.goal_id = p_goal and app.can_read_goal(p_goal);
$$;
revoke all on function public.goal_progress_inputs(uuid) from public, anon;
grant execute on function public.goal_progress_inputs(uuid) to authenticated, service_role;
