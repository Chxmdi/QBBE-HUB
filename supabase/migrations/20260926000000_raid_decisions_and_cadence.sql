-- P1-RID-01..04: the risk trigger, an issue's impact and resolution plan,
-- and a decision request a project manager can send to someone who can
-- already read the project.
--
-- Decisions themselves already store alternatives, affected records and
-- reopen conditions. What they lacked was a project-page write path and a
-- request that points at the decision once it is made.

alter table public.risk
  add column if not exists trigger text;

comment on column public.risk.trigger is
  'The condition that would make this risk happen.';

alter table public.issue
  add column if not exists impact text,
  add column if not exists resolution_plan text;

comment on column public.issue.impact is
  'What the problem is doing to the project while it is still open.';
comment on column public.issue.resolution_plan is
  'How it will be resolved. Distinct from resolution, which records how it was.';

create table if not exists public.decision_request (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  project_id uuid not null references public.project (id) on delete cascade,
  requester_id uuid not null references public.user_profile (id),
  assignee_id uuid not null references public.user_profile (id),
  due_at date not null,
  context text not null,
  status text not null default 'open',
  decision_id uuid references public.decision (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint decision_request_status_check
    check (status in ('open', 'decided', 'declined')),
  constraint decision_request_decided_links_a_decision
    check (status <> 'decided' or decision_id is not null)
);

create index if not exists idx_decision_request_project
  on public.decision_request (project_id, status, due_at);

comment on table public.decision_request is
  'A project lead asking an authorized person to decide, with a due date and context.';

create or replace function app.enforce_decision_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.project p
    where p.id = new.project_id and p.organization_id = new.organization_id
  ) then
    raise exception 'A decision request must belong to its project''s organization.'
      using errcode = '23514';
  end if;

  if not public.actor_has_project_capability(new.assignee_id, new.project_id, 'read') then
    raise exception 'The person asked for a decision must already be allowed to read this project.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app.enforce_decision_request() from public, anon;
grant execute on function app.enforce_decision_request() to authenticated, service_role;

drop trigger if exists decision_request_enforce on public.decision_request;
create trigger decision_request_enforce
  before insert or update on public.decision_request
  for each row execute function app.enforce_decision_request();

drop trigger if exists decision_request_set_updated_at on public.decision_request;
create trigger decision_request_set_updated_at
  before update on public.decision_request
  for each row execute function set_updated_at();

alter table public.decision_request enable row level security;

drop policy if exists decision_request_read on public.decision_request;
create policy decision_request_read on public.decision_request
  for select to authenticated
  using (app.has_project_capability(project_id, 'read'));

drop policy if exists decision_request_insert on public.decision_request;
create policy decision_request_insert on public.decision_request
  for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and app.has_project_capability(project_id, 'manage')
  );

drop policy if exists decision_request_update on public.decision_request;
create policy decision_request_update on public.decision_request
  for update to authenticated
  using (
    app.has_project_capability(project_id, 'manage')
    or assignee_id = (select auth.uid())
  )
  with check (
    app.has_project_capability(project_id, 'manage')
    or assignee_id = (select auth.uid())
  );
