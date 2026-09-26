-- Epic #15: the columns and guards the notification, audit, and template
-- requirements already assumed. Existing rows keep working; nothing here
-- replaces the delivery queue or the workflow engine.

alter table public.notification
  add column if not exists reason text,
  add column if not exists context text,
  add column if not exists owner_label text,
  add column if not exists due_on date,
  add column if not exists project_id uuid references public.project (id) on delete set null,
  add column if not exists thread_id uuid;

comment on column public.notification.reason is
  'Why this person was included. Overlapping reasons on one event are merged into this text.';

alter table public.notification_preference
  add column if not exists category_modes jsonb not null default '{}'::jsonb,
  add column if not exists digest_weekday smallint not null default 1;

alter table public.notification_preference
  drop constraint if exists notification_digest_weekday_check;
alter table public.notification_preference
  add constraint notification_digest_weekday_check
  check (digest_weekday between 0 and 6);

-- A category is immediate, daily, weekly, or off. Digest subscribers who had
-- a category switched on were already being batched; everyone else stays immediate.
update public.notification_preference
set category_modes = jsonb_build_object(
  'assignment', case when not email_assignments then 'off' when email_digest then 'daily' else 'immediate' end,
  'mention', case when not email_mentions then 'off' when email_digest then 'daily' else 'immediate' end,
  'announcement', case when not email_announcements then 'off' when email_digest then 'daily' else 'immediate' end,
  'due_date', case when not email_due_dates then 'off' when email_digest then 'daily' else 'immediate' end
)
where category_modes = '{}'::jsonb;

alter table public.project_template
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.user_profile (id);

update public.project_template
set approved_at = coalesce(created_at, now()),
    approved_by = created_by
where approved_at is null
  and created_by is not null;

alter table public.project_template
  drop constraint if exists project_template_approval_complete;
alter table public.project_template
  add constraint project_template_approval_complete
  check ((approved_at is null) = (approved_by is null));

alter table public.agenda_template
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.user_profile (id);

alter table public.agenda_template
  drop constraint if exists agenda_template_approval_complete;
alter table public.agenda_template
  add constraint agenda_template_approval_complete
  check ((approved_at is null) = (approved_by is null));

create table if not exists public.record_template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  kind text not null,
  name text not null,
  structure jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  approved_by uuid references public.user_profile (id),
  created_by uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  constraint record_template_kind_check
    check (kind in ('task', 'event', 'update', 'report')),
  constraint record_template_approval_complete
    check ((approved_at is null) = (approved_by is null))
);

create index if not exists idx_record_template_org
  on public.record_template (organization_id, kind, name);

alter table public.record_template enable row level security;

drop policy if exists record_template_read on public.record_template;
create policy record_template_read on public.record_template
  for select to authenticated
  using (app.is_org_member(organization_id));

drop policy if exists record_template_write on public.record_template;
create policy record_template_write on public.record_template
  for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

comment on table public.record_template is
  'Approved structure for a task, event, update, or report. Instantiation copies structure only.';

-- Approval is an administrator act. Staff may draft; they may not approve,
-- and once a template is approved only an administrator may change or remove
-- it — otherwise an approved template could be rewritten and stay approved.
create or replace function app.guard_template_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.approved_at is not null
       and auth.uid() is not null
       and not app.is_org_admin(old.organization_id) then
      raise exception 'Only an administrator can remove an approved template'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE'
     and old.approved_at is not null
     and auth.uid() is not null
     and not app.is_org_admin(old.organization_id) then
    raise exception 'Only an administrator can change an approved template'
      using errcode = '42501';
  end if;
  if new.approved_at is not null
     and (tg_op = 'INSERT' or new.approved_at is distinct from old.approved_at)
     and not app.is_org_admin(new.organization_id) then
    raise exception 'Only an administrator can approve a template'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
     and old.approved_at is not null
     and new.approved_at is null
     and not app.is_org_admin(new.organization_id) then
    raise exception 'Only an administrator can withdraw template approval'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_template_approval() from public, anon, authenticated;

drop trigger if exists project_template_approval_guard on public.project_template;
create trigger project_template_approval_guard
  before insert or update or delete on public.project_template
  for each row execute function app.guard_template_approval();

drop trigger if exists agenda_template_approval_guard on public.agenda_template;
create trigger agenda_template_approval_guard
  before insert or update or delete on public.agenda_template
  for each row execute function app.guard_template_approval();

drop trigger if exists record_template_approval_guard on public.record_template;
create trigger record_template_approval_guard
  before insert or update or delete on public.record_template
  for each row execute function app.guard_template_approval();

alter table public.workflow_execution
  add column if not exists attempt int not null default 0,
  add column if not exists payload jsonb;

comment on column public.workflow_execution.payload is
  'Notification drafts to retry when outcome is failed. Cleared after a successful retry.';

insert into public.job_definition (name, description, schedule, queue, batch_size, max_attempts)
values (
  'retry-workflow-executions',
  'Retries workflow notifications that failed to record, without sending a second copy of one that succeeded.',
  '*/15 * * * *',
  'notifications',
  25,
  3
)
on conflict (name) do nothing;

-- Material changes the product has to be able to answer for: who, what, when.
create or replace function app.record_material_audit(
  p_organization uuid,
  p_event_type text,
  p_action text,
  p_object_type text,
  p_object_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_event (
    organization_id, actor_id, actor_type, event_type, action,
    object_type, object_id, metadata
  ) values (
    p_organization,
    auth.uid(),
    case when auth.uid() is null then 'system' else 'user' end,
    p_event_type,
    p_action,
    p_object_type,
    p_object_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function app.record_material_audit(uuid, text, text, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function app.audit_task_material()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform app.record_material_audit(
      old.organization_id, 'task.deletion', 'deleted', 'task', old.id,
      jsonb_build_object('title', old.title));
    return old;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    perform app.record_material_audit(
      new.organization_id, 'task.assignment', 'updated', 'task', new.id,
      jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
  end if;
  if new.status is distinct from old.status then
    perform app.record_material_audit(
      new.organization_id, 'task.status', 'updated', 'task', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.due_at is distinct from old.due_at then
    perform app.record_material_audit(
      new.organization_id, 'task.due_date', 'updated', 'task', new.id,
      jsonb_build_object('from', old.due_at, 'to', new.due_at));
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform app.record_material_audit(
      new.organization_id,
      case when new.archived_at is null then 'task.restore' else 'task.deletion' end,
      case when new.archived_at is null then 'restored' else 'archived' end,
      'task', new.id,
      jsonb_build_object('title', new.title));
  end if;
  return new;
end;
$$;

revoke all on function app.audit_task_material() from public, anon, authenticated;

drop trigger if exists task_material_audited on public.task;
create trigger task_material_audited
  after update or delete on public.task
  for each row execute function app.audit_task_material();

create or replace function app.audit_task_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.task_assignment;
  v_org uuid;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select organization_id into v_org from public.task where id = v_row.task_id;
  perform app.record_material_audit(
    v_org, 'task.assignment',
    case when tg_op = 'DELETE' then 'deleted' else 'created' end,
    'task', v_row.task_id,
    jsonb_build_object('user_id', v_row.user_id, 'role', v_row.role));
  return null;
end;
$$;

revoke all on function app.audit_task_role() from public, anon, authenticated;

drop trigger if exists task_role_audited on public.task_assignment;
create trigger task_role_audited
  after insert or delete on public.task_assignment
  for each row execute function app.audit_task_role();

create or replace function app.audit_project_health()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.health is distinct from old.health then
    perform app.record_material_audit(
      new.organization_id, 'project.health', 'updated', 'project', new.id,
      jsonb_build_object('from', old.health, 'to', new.health));
  end if;
  return new;
end;
$$;

revoke all on function app.audit_project_health() from public, anon, authenticated;

drop trigger if exists project_health_audited on public.project;
create trigger project_health_audited
  after update on public.project
  for each row execute function app.audit_project_health();

create or replace function app.audit_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.decision;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  perform app.record_material_audit(
    v_row.organization_id, 'decision',
    case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,
    'decision', v_row.id,
    jsonb_build_object('title', v_row.title));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app.audit_decision() from public, anon, authenticated;

drop trigger if exists decision_audited on public.decision;
create trigger decision_audited
  after insert or update or delete on public.decision
  for each row execute function app.audit_decision();

create or replace function app.audit_document_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform app.record_material_audit(
      old.organization_id, 'document.deletion', 'deleted', 'document', old.id,
      jsonb_build_object('title', old.title));
    return old;
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform app.record_material_audit(
      new.organization_id,
      case when new.archived_at is null then 'document.restore' else 'document.deletion' end,
      case when new.archived_at is null then 'restored' else 'archived' end,
      'document', new.id,
      jsonb_build_object('title', new.title));
  end if;
  return new;
end;
$$;

revoke all on function app.audit_document_archive() from public, anon, authenticated;

drop trigger if exists document_archive_audited on public.document;
create trigger document_archive_audited
  after update or delete on public.document
  for each row execute function app.audit_document_archive();

-- A project template's items are part of what was approved, so the same rule
-- holds for them: on an approved template only an administrator may add,
-- change, or remove an item.
create or replace function app.guard_approved_template_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.project_template_item;
  v_org uuid;
  v_approved timestamptz;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select organization_id, approved_at into v_org, v_approved
  from public.project_template
  where id = v_row.project_template_id;
  -- No signed-in user means a system operation, such as a cascade.
  if v_approved is not null
     and auth.uid() is not null
     and not app.is_org_admin(v_org) then
    raise exception 'Only an administrator can change an approved template'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;

revoke all on function app.guard_approved_template_item() from public, anon, authenticated;

drop trigger if exists project_template_item_approval_guard on public.project_template_item;
create trigger project_template_item_approval_guard
  before insert or update or delete on public.project_template_item
  for each row execute function app.guard_approved_template_item();
