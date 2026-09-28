-- Team oversight (#136), phase 2: one person's work, and the thresholds that
-- decide when it needs attention.
--
-- Everything here reads work records the app already keeps: tasks, projects,
-- decision requests, meeting action items and the activity feed. Nothing
-- reads sign-ins, sessions, presence or message content, and the activity
-- timeline leaves out message events so no message text can reach it.

-- ---------------------------------------------------------------------------
-- Thresholds, one row per organization
-- ---------------------------------------------------------------------------
--
-- The defaults are the ones agreed on #136. An organization without a row
-- reads the defaults through app.team_signal_thresholds(), so nothing has to
-- be inserted for the rules to apply. Reminders and the weekly digest start
-- switched off: the staff privacy notice (decision 6 on #136) has to be
-- settled before either is turned on.

create table public.team_signal_settings (
  organization_id uuid primary key references public.organization (id) on delete cascade,
  overdue_count int not null default 3 check (overdue_count between 1 and 100),
  overdue_age_days int not null default 7 check (overdue_age_days between 1 and 365),
  blocked_no_update_days int not null default 5 check (blocked_no_update_days between 1 and 365),
  in_progress_no_update_days int not null default 7 check (in_progress_no_update_days between 1 and 365),
  flag_project_reports boolean not null default true,
  flag_overdue_decisions boolean not null default true,
  reminders_enabled boolean not null default false,
  digest_enabled boolean not null default false,
  updated_by uuid references public.user_profile (id),
  updated_at timestamptz not null default now()
);

comment on table public.team_signal_settings is
  'When a staff member''s work needs attention (#136). Missing row means the agreed defaults.';

alter table public.team_signal_settings enable row level security;

-- Staff read the thresholds so their own summary uses the same rules their
-- manager sees; only owners and admins who completed MFA change them.
create policy team_signal_settings_read on public.team_signal_settings
  for select to authenticated using (app.is_org_staff(organization_id));
create policy team_signal_settings_manage on public.team_signal_settings
  for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

create trigger trg_team_signal_settings_updated_at before update on public.team_signal_settings
  for each row execute function public.set_updated_at();

-- The organization's thresholds, or the defaults when it has not set any.
-- The literals repeat the column defaults above on purpose: a missing row
-- must read exactly like a freshly inserted one.
create or replace function app.team_signal_thresholds(p_organization uuid)
returns table (
  overdue_count int,
  overdue_age_days int,
  blocked_no_update_days int,
  in_progress_no_update_days int,
  flag_project_reports boolean,
  flag_overdue_decisions boolean,
  reminders_enabled boolean,
  digest_enabled boolean
)
language sql stable security definer
set search_path = ''
as $$
  select
    coalesce(s.overdue_count, 3),
    coalesce(s.overdue_age_days, 7),
    coalesce(s.blocked_no_update_days, 5),
    coalesce(s.in_progress_no_update_days, 7),
    coalesce(s.flag_project_reports, true),
    coalesce(s.flag_overdue_decisions, true),
    coalesce(s.reminders_enabled, false),
    coalesce(s.digest_enabled, false)
  from (select p_organization as id) o
  left join public.team_signal_settings s on s.organization_id = o.id;
$$;

revoke all on function app.team_signal_thresholds(uuid) from public, anon;
grant execute on function app.team_signal_thresholds(uuid) to authenticated, service_role;

-- Whether a project's reporting date has passed: the same rule as
-- src/features/projects/stale.ts (isProjectStale), which the dashboard, the
-- stale sweep and the team overview use. Kept beside it in words so the two
-- cannot drift: an active-stage project with a weekly or monthly cadence
-- whose last status update (or creation, if none) is older than the cadence.
create or replace function app.project_report_overdue(
  p_stage text,
  p_archived_at timestamptz,
  p_cadence text,
  p_last_update timestamptz,
  p_created_at timestamptz
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_archived_at is null
    and p_stage in ('approved', 'planning', 'active')
    and p_cadence in ('weekly', 'monthly')
    and coalesce(p_last_update, p_created_at)
        < now() - make_interval(days => case p_cadence when 'weekly' then 7 else 30 end);
$$;

-- ---------------------------------------------------------------------------
-- The team overview reads the organization's thresholds
-- ---------------------------------------------------------------------------
--
-- Same signature and columns as 20260926090000; only the two "no update for
-- N days" ages now come from the organization's settings instead of being
-- fixed at 5 and 7 (still the defaults).

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
    select m.organization_id, th.blocked_no_update_days, th.in_progress_no_update_days
    from public.organization_membership m
    cross join lateral app.team_signal_thresholds(m.organization_id) th
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
                       and t.updated_at < now() - make_interval(days => t.blocked_days)) as blocked_stale,
      count(*) filter (where t.is_open and t.status = 'in_progress'
                       and t.updated_at < now() - make_interval(days => t.in_progress_days)) as in_progress_stale,
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
        a.blocked_no_update_days as blocked_days,
        a.in_progress_no_update_days as in_progress_days,
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

-- ---------------------------------------------------------------------------
-- One person's work
-- ---------------------------------------------------------------------------
--
-- Who may read it: the person themselves, while they are an active owner,
-- admin or staff member; or an owner/admin of the same organization who
-- completed MFA (app.is_org_admin). Anyone else, including an admin asking
-- about a volunteer or a guest, gets null. Signed-out callers cannot execute
-- it at all.
--
-- One call returns the figures (the same definitions as team_overview, so
-- the overview row and this page cannot disagree), the open work grouped as
-- the page shows it, and one page of the activity timeline. The timeline
-- stops at the organization's activity retention window and pages by time:
-- pass the created_at of the last entry shown as p_activity_before.

create or replace function public.person_work_summary(
  p_user_id uuid,
  p_today date,
  p_activity_before timestamptz default null,
  p_activity_limit int default 25
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_role text;
  v_limit int := least(greatest(coalesce(p_activity_limit, 25), 1), 100);
  v_th record;
  v_since timestamptz;
  v_person jsonb;
  v_figures jsonb;
  v_tasks jsonb;
  v_projects jsonb;
  v_decisions jsonb;
  v_actions jsonb;
  v_activity jsonb;
  v_has_more boolean;
begin
  if auth.uid() is null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    return null;
  end if;

  select m.organization_id, m.role::text
  into v_org, v_role
  from public.organization_membership m
  where m.user_id = p_user_id
    and m.status = 'active'
    and m.role in ('owner', 'admin', 'staff')
    and (p_user_id = auth.uid() or app.is_org_admin(m.organization_id))
  order by m.joined_at nulls last
  limit 1;

  if v_org is null then
    return null;
  end if;

  select * into v_th from app.team_signal_thresholds(v_org);

  -- The retention window: the organization's activity policy when it is
  -- switched on, otherwise the subject's default (365 days).
  select now() - make_interval(days => coalesce(
           (select rp.retain_days from public.retention_policy rp
             where rp.organization_id = v_org and rp.subject_key = 'activity_event' and rp.enabled),
           (select rs.default_days from public.retention_subject rs where rs.key = 'activity_event'),
           365))
  into v_since;

  select jsonb_build_object(
           'user_id', u.id,
           'organization_id', v_org,
           'role', v_role,
           'full_name', u.full_name,
           'avatar_url', u.avatar_url,
           'title', u.title)
  into v_person
  from public.user_profile u
  where u.id = p_user_id;

  with t as (
    select
      t.id, t.title, t.status::text as status, t.due_at, t.updated_at, t.completed_at,
      t.project_id,
      (t.status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
        and t.archived_at is null) as is_open
    from public.task t
    where t.organization_id = v_org
      and t.assignee_id = p_user_id
      and (t.archived_at is null or t.status = 'completed')
  ),
  owned as (
    select
      p.id,
      app.project_report_overdue(p.stage::text, p.archived_at, p.reporting_cadence,
                                 p.last_status_update_at, p.created_at) as report_overdue
    from public.project p
    where p.organization_id = v_org
      and p.owner_id = p_user_id
      and p.archived_at is null
      and p.stage::text not in ('completed', 'cancelled', 'archived')
  ),
  actions as (
    select a.id
    from public.meeting_action a
    join public.meeting mt on mt.id = a.meeting_id
    left join public.task at on at.id = a.task_id
    where mt.organization_id = v_org
      and a.owner_id = p_user_id
      and mt.status::text <> 'cancelled'
      and (a.task_id is null
           or (at.status::text not in ('completed', 'cancelled') and at.archived_at is null))
  )
  select jsonb_build_object(
    'open_tasks', (select count(*) from t where is_open),
    'overdue', (select count(*) from t where is_open and due_at < p_today),
    'oldest_overdue_due', (select min(due_at) from t where is_open and due_at < p_today),
    'due_this_week', (select count(*) from t where is_open and due_at >= p_today and due_at <= p_today + 7),
    'blocked', (select count(*) from t where is_open and status = 'blocked'),
    'blocked_stale', (select count(*) from t where is_open and status = 'blocked'
                        and updated_at < now() - make_interval(days => v_th.blocked_no_update_days)),
    'in_progress_stale', (select count(*) from t where is_open and status = 'in_progress'
                            and updated_at < now() - make_interval(days => v_th.in_progress_no_update_days)),
    'completed_7', (select count(*) from t where status = 'completed' and completed_at >= now() - interval '7 days'),
    'completed_prev_7', (select count(*) from t where status = 'completed'
                           and completed_at >= now() - interval '14 days'
                           and completed_at < now() - interval '7 days'),
    'completed_30', (select count(*) from t where status = 'completed' and completed_at >= now() - interval '30 days'),
    'open_decisions', (select count(*) from public.decision_request d
                         where d.organization_id = v_org and d.assignee_id = p_user_id and d.status = 'open'),
    'overdue_decisions', (select count(*) from public.decision_request d
                            where d.organization_id = v_org and d.assignee_id = p_user_id
                              and d.status = 'open' and d.due_at < p_today),
    'owned_projects', (select count(*) from owned),
    'stale_projects', (select count(*) from owned where report_overdue),
    'open_meeting_actions', (select count(*) from actions),
    'last_activity_at', (select max(e.created_at) from public.activity_event e
                           where e.organization_id = v_org and e.actor_id = p_user_id)
  )
  into v_figures;

  -- Open work, grouped the way the page shows it. A task lands in the first
  -- group that fits: overdue, then blocked, then due within seven days, then
  -- later (which includes no due date).
  select coalesce(jsonb_agg(x order by x.sort_group, x.due_at nulls last, x.title), '[]'::jsonb)
  into v_tasks
  from (
    select
      t.id, t.title, t.status::text as status, t.due_at, t.updated_at, t.project_id,
      p.name as project_name,
      case
        when t.due_at < p_today then 'overdue'
        when t.status = 'blocked' then 'blocked'
        when t.due_at <= p_today + 7 then 'this_week'
        else 'later'
      end as "group",
      case
        when t.due_at < p_today then 1
        when t.status = 'blocked' then 2
        when t.due_at <= p_today + 7 then 3
        else 4
      end as sort_group,
      (t.status = 'blocked' and t.updated_at < now() - make_interval(days => v_th.blocked_no_update_days))
        or (t.status = 'in_progress' and t.updated_at < now() - make_interval(days => v_th.in_progress_no_update_days))
        as no_recent_update
    from public.task t
    left join public.project p on p.id = t.project_id
    where t.organization_id = v_org
      and t.assignee_id = p_user_id
      and t.archived_at is null
      and t.status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
    order by sort_group, t.due_at nulls last
    limit 200
  ) x;

  select coalesce(jsonb_agg(x order by x.report_overdue desc, x.name), '[]'::jsonb)
  into v_projects
  from (
    select
      p.id, p.name, p.stage::text as stage, p.health::text as health,
      p.reporting_cadence, p.last_status_update_at, p.created_at,
      app.project_report_overdue(p.stage::text, p.archived_at, p.reporting_cadence,
                                 p.last_status_update_at, p.created_at) as report_overdue
    from public.project p
    where p.organization_id = v_org
      and p.owner_id = p_user_id
      and p.archived_at is null
      and p.stage::text not in ('completed', 'cancelled', 'archived')
    limit 100
  ) x;

  select coalesce(jsonb_agg(x order by x.due_at, x.id), '[]'::jsonb)
  into v_decisions
  from (
    select d.id, d.context, d.due_at, d.project_id, p.name as project_name,
           d.due_at < p_today as overdue
    from public.decision_request d
    join public.project p on p.id = d.project_id
    where d.organization_id = v_org
      and d.assignee_id = p_user_id
      and d.status = 'open'
    order by d.due_at
    limit 100
  ) x;

  select coalesce(jsonb_agg(x order by x.due_at nulls last, x.title), '[]'::jsonb)
  into v_actions
  from (
    select a.id, a.title, a.due_at, a.meeting_id, a.task_id, mt.title as meeting_title,
           mt.starts_at as meeting_starts_at,
           coalesce(a.due_at < p_today, false) as overdue
    from public.meeting_action a
    join public.meeting mt on mt.id = a.meeting_id
    left join public.task at on at.id = a.task_id
    where mt.organization_id = v_org
      and a.owner_id = p_user_id
      and mt.status::text <> 'cancelled'
      and (a.task_id is null
           or (at.status::text not in ('completed', 'cancelled') and at.archived_at is null))
    order by a.due_at nulls last
    limit 100
  ) x;

  -- One page of the timeline plus one extra row to know whether more exist.
  -- Message events are left out: their summaries can quote what was said.
  with page as (
    select e.id, e.verb, e.source_type, e.source_id, e.project_id, e.program_id,
           e.summary, e.created_at
    from public.activity_event e
    where e.organization_id = v_org
      and e.actor_id = p_user_id
      and e.source_type not in ('message', 'channel', 'thread', 'dm')
      and e.created_at >= v_since
      and (p_activity_before is null or e.created_at < p_activity_before)
    order by e.created_at desc, e.id desc
    limit v_limit + 1
  )
  select
    coalesce((select jsonb_agg(x order by x.created_at desc, x.id desc)
              from (select * from page order by created_at desc, id desc limit v_limit) x), '[]'::jsonb),
    (select count(*) from page) > v_limit
  into v_activity, v_has_more;

  return jsonb_build_object(
    'person', v_person,
    'thresholds', jsonb_build_object(
      'overdue_count', v_th.overdue_count,
      'overdue_age_days', v_th.overdue_age_days,
      'blocked_no_update_days', v_th.blocked_no_update_days,
      'in_progress_no_update_days', v_th.in_progress_no_update_days,
      'flag_project_reports', v_th.flag_project_reports,
      'flag_overdue_decisions', v_th.flag_overdue_decisions),
    'figures', v_figures,
    'tasks', v_tasks,
    'projects', v_projects,
    'decisions', v_decisions,
    'meeting_actions', v_actions,
    'activity', v_activity,
    'activity_has_more', v_has_more,
    'activity_since', v_since
  );
end;
$$;

revoke all on function public.person_work_summary(uuid, date, timestamptz, int) from public, anon;
grant execute on function public.person_work_summary(uuid, date, timestamptz, int) to authenticated, service_role;

-- Open work by assignee, and owned projects by owner, are read per person.
create index if not exists idx_task_org_assignee_open
  on public.task (organization_id, assignee_id)
  where archived_at is null;
create index if not exists idx_meeting_action_owner
  on public.meeting_action (owner_id);
