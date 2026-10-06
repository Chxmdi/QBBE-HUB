-- Team oversight (#136), phase 3: signals, a gentle reminder to the person,
-- and a weekly digest for admins.
--
-- A signal is one of the attention rules agreed on #136, evaluated against
-- the organization's thresholds (team_signal_settings):
--   overdue          N or more overdue tasks, or any task overdue by more than N days;
--   blocked          a blocked task with no update for N days;
--   in_progress      a task in progress with no update for N days;
--   project_reports  a project they own whose report is overdue;
--   decisions        a decision request past its due date.
--
-- Only work records are read. Nothing here reads or stores sign-ins,
-- sessions, presence or message content.
--
-- team_signal remembers which signals are open so the person is reminded
-- once when a signal starts, not every day it stands. When it clears and
-- later comes back, that is a new signal and a new reminder.

create table public.team_signal (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  kind text not null
    check (kind in ('overdue', 'blocked', 'in_progress', 'project_reports', 'decisions')),
  opened_on date not null,
  last_seen_on date not null,
  item_count int not null default 0,
  reminded_at timestamptz,
  closed_on date,
  created_at timestamptz not null default now()
);

comment on table public.team_signal is
  'Open attention signals per person (#136), so a standing signal is reminded once, not daily.';

create unique index uq_team_signal_open
  on public.team_signal (organization_id, user_id, kind)
  where closed_on is null;

alter table public.team_signal enable row level security;

-- The person sees their own; owners and admins with MFA see their
-- organization's. Only the job runner (service role) writes.
create policy team_signal_read on public.team_signal
  for select to authenticated
  using (user_id = auth.uid() or app.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- The rules, per person, for one organization
-- ---------------------------------------------------------------------------
--
-- The figures use the same definitions as team_overview and
-- person_work_summary, so the digest, the reminder and both pages agree.
-- Internal: no caller check, so it is not executable by signed-in users.

create or replace function app.team_signal_figures(p_organization uuid, p_today date)
returns table (
  user_id uuid,
  full_name text,
  role text,
  overdue bigint,
  oldest_overdue_days int,
  blocked_stale bigint,
  in_progress_stale bigint,
  stale_projects bigint,
  overdue_decisions bigint,
  kinds text[]
)
language sql stable security definer
set search_path = ''
as $$
  with th as (
    select * from app.team_signal_thresholds(p_organization)
  ),
  people as (
    select m.user_id, m.role::text as role
    from public.organization_membership m
    where m.organization_id = p_organization
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'staff')
  ),
  tf as (
    select
      t.assignee_id,
      count(*) filter (where t.due_at < p_today) as overdue,
      min(t.due_at) filter (where t.due_at < p_today) as oldest,
      count(*) filter (where t.status::text = 'blocked'
                       and t.updated_at < now() - make_interval(days => th.blocked_no_update_days)) as blocked_stale,
      count(*) filter (where t.status::text = 'in_progress'
                       and t.updated_at < now() - make_interval(days => th.in_progress_no_update_days)) as in_progress_stale
    from public.task t
    cross join th
    where t.organization_id = p_organization
      and t.assignee_id is not null
      and t.archived_at is null
      and t.status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
    group by t.assignee_id
  ),
  pf as (
    select p.owner_id, count(*) as stale
    from public.project p
    where p.organization_id = p_organization
      and p.owner_id is not null
      and app.project_report_overdue(p.stage::text, p.archived_at, p.reporting_cadence,
                                     p.last_status_update_at, p.created_at)
    group by p.owner_id
  ),
  df as (
    select d.assignee_id, count(*) as late
    from public.decision_request d
    where d.organization_id = p_organization
      and d.status = 'open'
      and d.due_at < p_today
    group by d.assignee_id
  ),
  f as (
    select
      p.user_id,
      u.full_name,
      p.role,
      coalesce(tf.overdue, 0) as overdue,
      (p_today - tf.oldest)::int as oldest_overdue_days,
      coalesce(tf.blocked_stale, 0) as blocked_stale,
      coalesce(tf.in_progress_stale, 0) as in_progress_stale,
      coalesce(pf.stale, 0) as stale_projects,
      coalesce(df.late, 0) as overdue_decisions
    from people p
    join public.user_profile u on u.id = p.user_id
    left join tf on tf.assignee_id = p.user_id
    left join pf on pf.owner_id = p.user_id
    left join df on df.assignee_id = p.user_id
  )
  select
    f.user_id, f.full_name, f.role, f.overdue, f.oldest_overdue_days, f.blocked_stale,
    f.in_progress_stale, f.stale_projects, f.overdue_decisions,
    array_remove(array[
      case when f.overdue >= th.overdue_count
             or coalesce(f.oldest_overdue_days, 0) > th.overdue_age_days then 'overdue' end,
      case when f.blocked_stale > 0 then 'blocked' end,
      case when f.in_progress_stale > 0 then 'in_progress' end,
      case when th.flag_project_reports and f.stale_projects > 0 then 'project_reports' end,
      case when th.flag_overdue_decisions and f.overdue_decisions > 0 then 'decisions' end
    ], null) as kinds
  from f
  cross join th
  order by f.full_name;
$$;

revoke all on function app.team_signal_figures(uuid, date) from public, anon, authenticated;
grant execute on function app.team_signal_figures(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Daily: bring team_signal up to date and say who needs a reminder
-- ---------------------------------------------------------------------------
--
-- Closes signals that no longer hold, refreshes the ones that still do,
-- opens new ones, and returns every open signal nobody has been reminded of
-- yet (new today, or a reminder that failed on an earlier run). The job
-- marks them reminded once the notification is written.

create or replace function public.sync_team_signals(p_organization_id uuid, p_today date)
returns table (
  signal_id uuid,
  user_id uuid,
  kind text,
  item_count int,
  oldest_overdue_days int
)
language plpgsql volatile security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Scratch space for today's signals, gone at the end of the transaction.
  if to_regclass('pg_temp.team_signal_now') is null then
    create temporary table team_signal_now (
      user_id uuid, kind text, item_count int, oldest_overdue_days int
    ) on commit drop;
  else
    delete from pg_temp.team_signal_now;
  end if;

  insert into pg_temp.team_signal_now (user_id, kind, item_count, oldest_overdue_days)
  select f.user_id, k.kind,
         (case k.kind
            when 'overdue' then f.overdue
            when 'blocked' then f.blocked_stale
            when 'in_progress' then f.in_progress_stale
            when 'project_reports' then f.stale_projects
            else f.overdue_decisions
          end)::int,
         f.oldest_overdue_days
  from app.team_signal_figures(p_organization_id, p_today) f
  cross join lateral unnest(f.kinds) as k(kind);

  update public.team_signal s
  set closed_on = p_today
  where s.organization_id = p_organization_id
    and s.closed_on is null
    and not exists (
      select 1 from pg_temp.team_signal_now n
      where n.user_id = s.user_id and n.kind = s.kind
    );

  update public.team_signal s
  set last_seen_on = p_today, item_count = n.item_count
  from pg_temp.team_signal_now n
  where s.organization_id = p_organization_id
    and s.closed_on is null
    and s.user_id = n.user_id
    and s.kind = n.kind;

  insert into public.team_signal (organization_id, user_id, kind, opened_on, last_seen_on, item_count)
  select p_organization_id, n.user_id, n.kind, p_today, p_today, n.item_count
  from pg_temp.team_signal_now n
  on conflict (organization_id, user_id, kind) where closed_on is null do nothing;

  return query
  select s.id, s.user_id, s.kind, s.item_count, n.oldest_overdue_days
  from public.team_signal s
  left join pg_temp.team_signal_now n on n.user_id = s.user_id and n.kind = s.kind
  where s.organization_id = p_organization_id
    and s.closed_on is null
    and s.reminded_at is null
  order by s.user_id, s.kind;
end;
$$;

revoke all on function public.sync_team_signals(uuid, date) from public, anon, authenticated;
grant execute on function public.sync_team_signals(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Weekly: the people the admins' digest lists
-- ---------------------------------------------------------------------------
--
-- Only people with at least one signal right now. Read live rather than from
-- team_signal so the digest is correct even when reminders are switched off.

create or replace function public.team_signal_digest(p_organization_id uuid, p_today date)
returns table (
  user_id uuid,
  full_name text,
  role text,
  overdue bigint,
  oldest_overdue_days int,
  blocked_stale bigint,
  in_progress_stale bigint,
  stale_projects bigint,
  overdue_decisions bigint,
  kinds text[]
)
language sql stable security definer
set search_path = ''
as $$
  select f.*
  from app.team_signal_figures(p_organization_id, p_today) f
  where cardinality(f.kinds) > 0
  order by cardinality(f.kinds) desc, f.overdue desc, f.full_name;
$$;

revoke all on function public.team_signal_digest(uuid, date) from public, anon, authenticated;
grant execute on function public.team_signal_digest(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- The two jobs
-- ---------------------------------------------------------------------------
--
-- Both do nothing for an organization until an admin switches them on in
-- Admin, Team signals. Times are UTC: reminders at 13:20 (09:20 in Montréal
-- during daylight time), the digest on Mondays at 12:40.

insert into public.job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values
  ('team-signal-reminders',
   'Gently remind staff of work that needs attention, once per signal, where the organization has switched reminders on.',
   '20 13 * * *', null, true, 200, 3),
  ('team-signal-digest',
   'Email owners and admins a weekly list of people with open work signals, where the organization has switched the digest on.',
   '40 12 * * 1', null, true, 200, 3)
on conflict (name) do nothing;

select cron.schedule('team-signal-reminders', '20 13 * * *',
  $$select app.dispatch_job('team-signal-reminders')$$);
select cron.schedule('team-signal-digest', '40 12 * * 1',
  $$select app.dispatch_job('team-signal-digest')$$);
