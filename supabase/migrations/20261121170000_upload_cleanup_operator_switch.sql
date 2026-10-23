-- The cleanup of unregistered uploads deletes files only once an operator
-- has said so (SEC-016). Deleting production files needs the owner's OK, so
-- the purge-unregistered-uploads job reports what it would delete (files,
-- size and oldest date per bucket; logged and audited) until the
-- "purge-unregistered-uploads" switch is on.
--
-- operator_switch holds such switches. Nobody signed in reads or writes it
-- directly: set_operator_switch changes one, for an owner signed in with a
-- second factor (through the API, deliberately: the owner is who decides),
-- the service role, or someone with direct database access (the hosted
-- dashboard's SQL editor); it records who, how and when, and audits it,
-- with the database login and client address for direct access. The job
-- reads it with the service role.

create table public.operator_switch (
  name text primary key check (name in ('purge-unregistered-uploads')),
  enabled boolean not null default false,
  changed_by uuid references auth.users (id) on delete set null,
  -- 'owner' (signed in, second factor), 'service_role' or 'database'.
  changed_via text check (changed_via in ('owner', 'service_role', 'database')),
  changed_at timestamptz
);
comment on table public.operator_switch is
  'Switches an operator turns on before a job may change production data. Changed only through set_operator_switch.';
alter table public.operator_switch enable row level security;
revoke all on table public.operator_switch from public, anon, authenticated, service_role;
grant select on table public.operator_switch to service_role;

insert into public.operator_switch (name, enabled) values ('purge-unregistered-uploads', false)
on conflict (name) do nothing;

create or replace function public.set_operator_switch(p_name text, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_via text;
  v_org uuid;
begin
  if v_role = 'service_role' then
    v_via := 'service_role';
  elsif v_role = '' and v_uid is null and session_user in ('postgres', 'supabase_admin') then
    -- Not through the API at all: the database's own administrators.
    v_via := 'database';
  else
    v_via := 'owner';
    -- The Hub is invite-only for one organization: its owners are the
    -- operators. With several organizations this would need a platform
    -- operator role instead.
    select m.organization_id into v_org
    from public.organization_membership m
    where m.user_id = v_uid and m.status = 'active' and m.role = 'owner'
    order by m.created_at
    limit 1;
    if v_uid is null or v_org is null or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
      raise exception 'Only an owner signed in with a second factor can change this' using errcode = '42501';
    end if;
  end if;
  update public.operator_switch
  set enabled = p_enabled, changed_by = v_uid, changed_via = v_via, changed_at = now()
  where name = p_name;
  if not found then
    raise exception 'There is no switch called "%"', p_name using errcode = '22023';
  end if;
  insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action, metadata)
  values (v_org, v_uid, case when v_via = 'owner' then 'user' else 'system' end, 'operations', 'operator_switch_changed',
          jsonb_build_object('switch', p_name, 'enabled', p_enabled, 'via', v_via)
            || case when v_via = 'database' then jsonb_build_object(
                 'login', session_user::text,
                 'client', host(inet_client_addr()),
                 'application', current_setting('application_name', true))
               else '{}'::jsonb end);
end;
$$;
revoke all on function public.set_operator_switch(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_operator_switch(text, boolean) to authenticated, service_role;

-- What the job reports while the switch is off.
create or replace function public.unregistered_uploads_summary(p_before timestamptz)
returns table (bucket_id text, files bigint, bytes numeric, oldest timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id,
         count(*),
         coalesce(sum((o.metadata ->> 'size')::numeric) filter (where jsonb_typeof(o.metadata -> 'size') = 'number'), 0),
         min(o.created_at)
  from storage.objects o
  where o.bucket_id in ('documents', 'receipts', 'form-files', 'signing-documents')
    and o.created_at < p_before
    and not app.storage_object_registered(o.bucket_id, o.name)
    and not (o.bucket_id = 'documents' and exists (
      select 1 from public.capture_item c where c.storage_path = o.name and c.status <> 'dismissed'
    ))
  group by o.bucket_id
  order by o.bucket_id;
$$;
revoke all on function public.unregistered_uploads_summary(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.unregistered_uploads_summary(timestamptz) to service_role;

update public.job_definition
set description = 'Reports uploads nobody registered, older than 24 hours, in the four upload buckets; deletes them once the purge-unregistered-uploads operator switch is on.'
where name = 'purge-unregistered-uploads';

-- A person's data export covers every column naming a person, or says why not.
insert into app.person_data_registry
  (subject, table_name, column_name, match, scope, parent_table, parent_column, columns, excluded_reason)
values
  ('person', 'operator_switch', 'changed_by', null, null, null, null, null,
   'Who last changed an operations switch; each change is in the audit trail, exported through audit_event.actor_id.')
on conflict do nothing;
