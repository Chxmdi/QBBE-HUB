-- Team overview (#136, phase 1): one row per staff member with the state of
-- the work assigned to them, for workspace administrators.
--
-- Every figure comes from work records the app already keeps: tasks,
-- decision requests and the activity feed. Nothing here reads sign-ins,
-- sessions, presence or message content, and nothing new is recorded.
--
-- SECURITY DEFINER so the counts are complete rather than limited by the
-- caller's own task visibility, which makes the caller check below the only
-- gate: rows come back only for organizations where app.is_org_admin() holds,
-- which already requires an active owner/admin membership, the aal2 claim and
-- a live verified TOTP factor. Anyone else, including an admin who has not
-- completed MFA, gets no rows.
--
-- p_today is the organization's calendar date, passed by the caller as the
-- dashboard does, so "overdue" does not roll over on the server's UTC clock.

create or replace function public.team_overview(p_today date)
returns table (
  user_id uuid,
  organization_id uuid,
  role text,
  full_name text,
  avatar_url text,
  title text,
  open_tasks bigint,
  overdue bigint,
  oldest_overdue_due date,
  due_this_week bigint,
  blocked bigint,
  blocked_stale bigint,
  in_progress_stale bigint,
  completed_7 bigint,
  completed_prev_7 bigint,
  completed_30 bigint,
  open_decisions bigint,
  overdue_decisions bigint,
  last_activity_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  with admin_orgs as (
    select m.organization_id
    from public.organization_membership m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
      and app.is_org_admin(m.organization_id)
  ),
  people as (
    select m.user_id, m.organization_id, m.role::text as role
    from public.organization_membership m
    join admin_orgs a on a.organization_id = m.organization_id
    where m.status = 'active'
      and m.role in ('owner', 'admin', 'staff')
  ),
  task_figures as (
    select
      t.organization_id,
      t.assignee_id,
      count(*) filter (where t.is_open) as open_tasks,
      count(*) filter (where t.is_open and t.due_at < p_today) as overdue,
      min(t.due_at) filter (where t.is_open and t.due_at < p_today) as oldest_overdue_due,
      count(*) filter (where t.is_open and t.due_at >= p_today and t.due_at <= p_today + 7) as due_this_week,
      count(*) filter (where t.is_open and t.status = 'blocked') as blocked,
      count(*) filter (where t.is_open and t.status = 'blocked'
                       and t.updated_at < now() - interval '5 days') as blocked_stale,
      count(*) filter (where t.is_open and t.status = 'in_progress'
                       and t.updated_at < now() - interval '7 days') as in_progress_stale,
      count(*) filter (where t.status = 'completed'
                       and t.completed_at >= now() - interval '7 days') as completed_7,
      count(*) filter (where t.status = 'completed'
                       and t.completed_at >= now() - interval '14 days'
                       and t.completed_at < now() - interval '7 days') as completed_prev_7,
      count(*) filter (where t.status = 'completed'
                       and t.completed_at >= now() - interval '30 days') as completed_30
    from (
      select
        t.organization_id, t.assignee_id, t.status::text as status, t.due_at,
        t.updated_at, t.completed_at,
        (t.status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
          and t.archived_at is null) as is_open
      from public.task t
      join admin_orgs a on a.organization_id = t.organization_id
      where t.assignee_id is not null
        and (t.archived_at is null or t.status = 'completed')
    ) t
    group by t.organization_id, t.assignee_id
  ),
  decision_figures as (
    select
      d.organization_id,
      d.assignee_id,
      count(*) as open_decisions,
      count(*) filter (where d.due_at < p_today) as overdue_decisions
    from public.decision_request d
    join admin_orgs a on a.organization_id = d.organization_id
    where d.status = 'open'
    group by d.organization_id, d.assignee_id
  ),
  activity as (
    select e.organization_id, e.actor_id, max(e.created_at) as last_activity_at
    from public.activity_event e
    join admin_orgs a on a.organization_id = e.organization_id
    where e.actor_id is not null
    group by e.organization_id, e.actor_id
  )
  select
    p.user_id,
    p.organization_id,
    p.role,
    u.full_name,
    u.avatar_url,
    u.title,
    coalesce(tf.open_tasks, 0),
    coalesce(tf.overdue, 0),
    tf.oldest_overdue_due,
    coalesce(tf.due_this_week, 0),
    coalesce(tf.blocked, 0),
    coalesce(tf.blocked_stale, 0),
    coalesce(tf.in_progress_stale, 0),
    coalesce(tf.completed_7, 0),
    coalesce(tf.completed_prev_7, 0),
    coalesce(tf.completed_30, 0),
    coalesce(df.open_decisions, 0),
    coalesce(df.overdue_decisions, 0),
    ac.last_activity_at
  from people p
  join public.user_profile u on u.id = p.user_id
  left join task_figures tf
    on tf.organization_id = p.organization_id and tf.assignee_id = p.user_id
  left join decision_figures df
    on df.organization_id = p.organization_id and df.assignee_id = p.user_id
  left join activity ac
    on ac.organization_id = p.organization_id and ac.actor_id = p.user_id
  order by u.full_name;
$$;

revoke all on function public.team_overview(date) from public, anon;
grant execute on function public.team_overview(date) to authenticated, service_role;

-- The per-person activity lookup above reads the feed by actor; the existing
-- indexes are by source and by organization/time only.
create index if not exists idx_activity_actor
  on public.activity_event (organization_id, actor_id, created_at desc);
