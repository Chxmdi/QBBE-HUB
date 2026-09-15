-- PRD v2 workstream completion: lifecycle fields, comments, files, meetings,
-- CRM links, search arms, cadence and notification mutes.

alter table public.program
  add column if not exists color text not null default 'neutral',
  add column if not exists important_links jsonb not null default '[]'::jsonb;

alter table public.project
  add column if not exists sponsor_id uuid references public.user_profile (id),
  add column if not exists priority public.task_priority not null default 'medium',
  add column if not exists reporting_cadence text not null default 'none',
  add column if not exists last_status_update_at timestamptz;

alter table public.project
  drop constraint if exists project_reporting_cadence_check;
alter table public.project
  add constraint project_reporting_cadence_check
  check (reporting_cadence in ('none', 'weekly', 'monthly'));

create or replace function public.enforce_active_project_prerequisites()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage = 'active' then
    if new.program_id is null or coalesce(new.outcome, '') = '' or new.target_date is null then
      raise exception 'An active project needs a program, outcome and target date.'
        using errcode = '23514';
    end if;
    if new.health in ('at_risk', 'off_track') and coalesce(new.health_reason, '') = '' then
      raise exception 'Adverse health requires a reason.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_active_project_prerequisites on public.project;
create trigger trg_active_project_prerequisites
  before insert or update on public.project
  for each row execute function public.enforce_active_project_prerequisites();

alter table public.milestone
  add column if not exists owner_id uuid references public.user_profile (id),
  add column if not exists description text,
  add column if not exists status text not null default 'planned',
  add column if not exists evidence text;

alter table public.milestone
  drop constraint if exists milestone_status_check;
alter table public.milestone
  add constraint milestone_status_check
  check (status in ('planned', 'in_progress', 'completed', 'missed'));

alter table public.task
  add column if not exists completion_criteria text,
  add column if not exists approver_id uuid references public.user_profile (id);

create table if not exists public.task_assignment (
  task_id uuid not null references public.task (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id, role),
  constraint task_assignment_role_check
    check (role in ('contributor', 'reviewer', 'approver', 'follower'))
);
alter table public.task_assignment enable row level security;
drop policy if exists task_assignment_read on public.task_assignment;
create policy task_assignment_read on public.task_assignment for select to authenticated
  using (public.has_task_capability(task_id, 'read'));
drop policy if exists task_assignment_write on public.task_assignment;
create policy task_assignment_write on public.task_assignment for all to authenticated
  using (public.has_task_capability(task_id, 'manage'))
  with check (public.has_task_capability(task_id, 'manage'));

alter type public.project_request_status add value if not exists 'deferred';
alter type public.project_request_status add value if not exists 'returned';

create table if not exists public.record_comment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  parent_type text not null,
  parent_id uuid not null,
  parent_comment_id uuid references public.record_comment (id) on delete cascade,
  author_id uuid not null references public.user_profile (id),
  body text not null,
  resolved_at timestamptz,
  resolved_by uuid references public.user_profile (id),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint record_comment_parent_type_check
    check (parent_type in (
      'project', 'task', 'milestone', 'event', 'meeting', 'agenda_item',
      'risk', 'issue', 'update', 'organization', 'contact', 'opportunity'
    ))
);
create index if not exists idx_record_comment_parent
  on public.record_comment (parent_type, parent_id, created_at);
alter table public.record_comment enable row level security;

create or replace function public.can_read_comment_parent(
  p_type text,
  p_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_type
    when 'project' then app.has_project_capability(p_id, 'read')
    when 'task' then app.has_task_capability(p_id, 'read')
    when 'milestone' then exists (
      select 1 from public.milestone m
      where m.id = p_id and app.has_project_capability(m.project_id, 'read')
    )
    when 'event' then app.can_read_event(p_id)
    when 'meeting' then app.can_read_meeting(p_id)
    when 'agenda_item' then exists (
      select 1 from public.agenda_item a
      where a.id = p_id and app.can_read_meeting(a.meeting_id)
    )
    when 'risk' then exists (
      select 1 from public.risk r
      where r.id = p_id and app.has_project_capability(r.project_id, 'read')
    )
    when 'issue' then exists (
      select 1 from public.issue i
      where i.id = p_id and app.has_project_capability(i.project_id, 'read')
    )
    when 'update' then exists (
      select 1 from public.project_status_update u
      where u.id = p_id and app.has_project_capability(u.project_id, 'read')
    )
    when 'organization' then app.can_access_crm((
      select c.organization_id from public.crm_organization c where c.id = p_id
    ))
    when 'contact' then app.can_access_crm((
      select c.organization_id from public.crm_contact c where c.id = p_id
    ))
    when 'opportunity' then app.can_access_crm((
      select o.organization_id from public.opportunity o where o.id = p_id
    ))
    else false
  end;
$$;

revoke all on function public.can_read_comment_parent(text, uuid) from public, anon;
grant execute on function public.can_read_comment_parent(text, uuid)
  to authenticated, service_role;

create policy record_comment_read on public.record_comment for select to authenticated
  using (public.can_read_comment_parent(parent_type, parent_id));
create policy record_comment_insert on public.record_comment for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_read_comment_parent(parent_type, parent_id)
  );
create policy record_comment_update on public.record_comment for update to authenticated
  using (author_id = (select auth.uid()) or app.is_org_admin(organization_id))
  with check (author_id = (select auth.uid()) or app.is_org_admin(organization_id));

alter table public.document
  add column if not exists scan_status text not null default 'pending',
  add column if not exists quarantined_at timestamptz,
  add column if not exists scan_note text;
alter table public.document
  drop constraint if exists document_scan_status_check;
alter table public.document
  add constraint document_scan_status_check
  check (scan_status in ('pending', 'clean', 'quarantined', 'rejected'));

create or replace function public.document_is_servable(p_document uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document d
    where d.id = p_document
      and (
        d.kind = 'link'
        or d.scan_status = 'clean'
      )
  );
$$;

create table if not exists public.event_checklist_item (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event (id) on delete cascade,
  title text not null,
  completed_at timestamptz,
  sort_key double precision not null default 0,
  created_at timestamptz not null default now()
);
alter table public.event_checklist_item enable row level security;
create policy event_checklist_read on public.event_checklist_item for select to authenticated
  using (app.can_read_event(event_id));
create policy event_checklist_write on public.event_checklist_item for all to authenticated
  using (app.can_manage_event(event_id))
  with check (app.can_manage_event(event_id));

alter table public.meeting
  add column if not exists event_id uuid references public.event (id) on delete set null,
  add column if not exists crm_organization_id uuid references public.crm_organization (id) on delete set null,
  add column if not exists recurrence_rule text,
  add column if not exists series_id uuid;

alter table public.agenda_item
  add column if not exists linked_task_id uuid references public.task (id) on delete set null,
  add column if not exists linked_milestone_id uuid references public.milestone (id) on delete set null,
  add column if not exists linked_risk_id uuid,
  add column if not exists linked_issue_id uuid,
  add column if not exists linked_event_id uuid references public.event (id) on delete set null,
  add column if not exists linked_decision_id uuid references public.decision (id) on delete set null,
  add column if not exists linked_contact_id uuid references public.crm_contact (id) on delete set null,
  add column if not exists carried_from_id uuid references public.agenda_item (id) on delete set null;

create table if not exists public.agenda_template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  name text not null,
  kind text not null,
  items jsonb not null default '[]'::jsonb,
  created_by uuid references public.user_profile (id),
  created_at timestamptz not null default now()
);
alter table public.agenda_template enable row level security;
create policy agenda_template_read on public.agenda_template for select to authenticated
  using (app.is_org_member(organization_id));
create policy agenda_template_write on public.agenda_template for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

alter table public.decision
  add column if not exists alternatives text,
  add column if not exists affected_records jsonb not null default '[]'::jsonb,
  add column if not exists reopen_conditions text,
  add column if not exists reopened_at timestamptz;

create table if not exists public.crm_link (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  crm_organization_id uuid references public.crm_organization (id) on delete cascade,
  contact_id uuid references public.crm_contact (id) on delete cascade,
  program_id uuid references public.program (id) on delete cascade,
  project_id uuid references public.project (id) on delete cascade,
  event_id uuid references public.event (id) on delete cascade,
  task_id uuid references public.task (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.crm_link enable row level security;
create policy crm_link_read on public.crm_link for select to authenticated
  using (app.can_access_crm(organization_id));
create policy crm_link_write on public.crm_link for all to authenticated
  using (app.can_access_crm(organization_id))
  with check (app.can_access_crm(organization_id));

alter table public.crm_organization
  add column if not exists next_action_at date,
  add column if not exists sensitive_notes text;
alter table public.crm_contact
  add column if not exists next_action_at date,
  add column if not exists sensitive_notes text;

alter table public.notification_preference
  add column if not exists delivery_mode text not null default 'immediate',
  add column if not exists muted_project_ids uuid[] not null default '{}',
  add column if not exists muted_thread_ids uuid[] not null default '{}';
alter table public.notification_preference
  drop constraint if exists notification_delivery_mode_check;
alter table public.notification_preference
  add constraint notification_delivery_mode_check
  check (delivery_mode in ('immediate', 'daily', 'weekly'));

create or replace function public.global_search(p_query text, p_limit int default 20)
returns table (
  result_type text,
  id uuid,
  title text,
  snippet text,
  href text
)
language sql stable security invoker
set search_path = public
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern),
  hits as (
    (
      select 'task' as result_type, t.id, t.title,
             coalesce(left(t.description, 120), '') as snippet,
             '/my-work?task=' || t.id as href,
             0::bigint as sort_key
      from task t, q where t.title ilike q.pattern and t.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'project', p.id, p.name, coalesce(left(p.outcome, 120), ''),
             '/projects/' || p.id, 0
      from project p, q where p.name ilike q.pattern and p.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'program', pr.id, pr.name, coalesce(left(pr.description, 120), ''),
             '/programs/' || pr.id, 0
      from program pr, q where pr.name ilike q.pattern and pr.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'channel', c.id, '#' || c.slug, coalesce(c.purpose, ''),
             '/channels/' || c.id, 0
      from channel c, q where (c.name ilike q.pattern or c.slug ilike q.pattern)
        and c.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'message', m.id, left(m.body, 80), 'in conversation',
             case when m.channel_id is not null
               then '/channels/' || m.channel_id || '?message=' || m.id
               else '/messages/' || m.conversation_id end,
             (-extract(epoch from m.created_at))::bigint
      from message m, q
      where m.body ilike q.pattern and m.deleted_at is null
      order by 6
      limit p_limit
    )
    union all
    (
      select 'person', u.id, u.full_name, coalesce(u.title, ''),
             '/people?person=' || u.id, 0
      from user_profile u, q where u.full_name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'meeting', mt.id, mt.title, to_char(mt.starts_at, 'YYYY-MM-DD HH24:MI'),
             '/meetings/' || mt.id, 0
      from meeting mt, q where mt.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'event', e.id, e.name, to_char(e.starts_at, 'YYYY-MM-DD'),
             '/events/' || e.id, 0
      from event e, q where e.name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'agenda', a.id, a.title, coalesce(a.desired_outcome, a.kind::text),
             '/meetings/' || a.meeting_id || '?item=' || a.id, 0
      from agenda_item a, q where a.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'crm', co.id, co.name, co.category, '/crm/' || co.id, 0
      from crm_organization co, q where co.name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'contact', ct.id, ct.full_name, coalesce(ct.role_title, ct.email, ''),
             '/crm/' || coalesce(ct.crm_organization_id, ct.id) || '?contact=' || ct.id, 0
      from crm_contact ct, q
      where ct.full_name ilike q.pattern or coalesce(ct.email, '') ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'risk', r.id, r.title,
             p.name || ' · ' || r.status,
             '/projects/' || r.project_id || '?tab=risks&risk=' || r.id, 0
      from risk r join project p on p.id = r.project_id, q
      where r.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'issue', i.id, i.title,
             p.name || ' · ' || i.status,
             '/projects/' || i.project_id || '?tab=risks&issue=' || i.id, 0
      from issue i join project p on p.id = i.project_id, q
      where i.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'document', d.id, d.title, coalesce(left(d.description, 120), d.kind::text),
             '/documents?document=' || d.id, 0
      from document d, q
      where (d.title ilike q.pattern or d.description ilike q.pattern)
        and d.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'opportunity', o.id, o.title, o.stage::text,
             '/crm/' || o.crm_organization_id || '?opportunity=' || o.id, 0
      from opportunity o, q where o.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'comment', c.id, left(c.body, 80), c.parent_type,
             '/search?comment=' || c.id, 0
      from record_comment c, q
      where c.body ilike q.pattern and c.deleted_at is null
      limit p_limit
    )
  ),
  ranked as (
    select h.*,
           row_number() over (
             partition by h.result_type order by h.sort_key, h.title, h.id
           ) as rank_in_type
    from hits h
  )
  select r.result_type, r.id, r.title, r.snippet, r.href
  from ranked r
  order by r.rank_in_type,
           case r.result_type
             when 'person' then 1 when 'task' then 2 when 'project' then 3
             when 'program' then 4 when 'channel' then 5 when 'meeting' then 6
             when 'event' then 7 when 'agenda' then 8 when 'contact' then 9
             when 'document' then 10 when 'risk' then 11 when 'issue' then 12
             when 'opportunity' then 13 when 'crm' then 14 when 'comment' then 15
             else 16
           end,
           r.sort_key
  limit p_limit;
$$;
