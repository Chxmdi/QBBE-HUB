-- Workspace OS M1c: objects for the other nine native types (epic #199).
--
-- Same recipe as M1b (map row, trigger, backfill in the same migration) for
-- meeting, decision, risk, outcome_metric, team, event, crm_contact and
-- document. People are the special case (design note section 3):
-- user_profile has no organization, so a person's object is written from
-- organization_membership, with the profile's id, and renamed when the
-- profile's full_name changes. A person is archived while their membership
-- is not active.
--
-- Contacts: only crm_contact's full name is copied. Sensitive notes stay in
-- their isolated table and never reach object.
--
-- Order matters for parents: meetings before decisions and documents (their
-- parent can be a meeting); projects already exist from M1b.

insert into app.native_object_map
  (native_table, type_key, title_column, owner_column, created_by_column,
   parent_columns, archived_column, archived_values)
values
  ('meeting', 'meeting', 'title', 'organizer_id', null, '{project_id}', 'status', '{cancelled}'),
  ('decision', 'decision', 'title', 'decided_by', null, '{meeting_id,project_id}', null, null),
  ('risk', 'risk', 'title', 'owner_id', 'created_by', '{project_id}', 'closed_at', null),
  ('outcome_metric', 'outcome_metric', 'name', 'owner_id', 'created_by', '{}', 'retired_at', null),
  ('team', 'team', 'name', 'owner_id', null, '{}', null, null),
  ('event', 'event', 'name', 'owner_id', 'created_by', '{project_id}', 'status', '{cancelled}'),
  ('crm_contact', 'contact', 'full_name', 'owner_id', null, '{}', 'status', '{inactive}'),
  ('document', 'document', 'title', 'owner_id', 'created_by', '{project_id,meeting_id}', 'archived_at', null),
  -- Fed from organization_membership, see app.person_object_row.
  ('user_profile', 'person', 'full_name', 'id', null, '{}', 'status', '{invited,deactivated}')
on conflict (native_table) do update set
  type_key = excluded.type_key,
  title_column = excluded.title_column,
  owner_column = excluded.owner_column,
  created_by_column = excluded.created_by_column,
  parent_columns = excluded.parent_columns,
  archived_column = excluded.archived_column,
  archived_values = excluded.archived_values;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'meeting', 'decision', 'risk', 'outcome_metric', 'team', 'event', 'crm_contact', 'document'
  ] loop
    execute format(
      'create trigger %1$s_object_sync after insert or update or delete on public.%1$I
         for each row execute function app.sync_object_from_native()',
      v_table
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- The row app.upsert_native_object expects for a person, built from their
-- membership and profile.
create or replace function app.person_object_row(p_membership public.organization_membership)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_membership.user_id,
    'organization_id', p_membership.organization_id,
    'full_name', coalesce(nullif(btrim(u.full_name), ''), u.email, ''),
    'status', p_membership.status::text,
    'created_at', p_membership.created_at,
    'updated_at', p_membership.updated_at
  )
  from public.user_profile u
  where u.id = p_membership.user_id;
$$;

revoke all on function app.person_object_row(public.organization_membership) from public, anon, authenticated;

create or replace function app.sync_person_object_from_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if tg_op = 'DELETE' then
    delete from public.object o
    where o.id = old.user_id and o.organization_id = old.organization_id;
    return old;
  end if;
  if tg_op = 'UPDATE'
    and new.status = old.status
    and new.user_id = old.user_id
    and new.organization_id = old.organization_id
    and exists (select 1 from public.object o where o.id = new.user_id)
  then
    return new;
  end if;
  v_row := app.person_object_row(new);
  if v_row is not null then
    perform app.upsert_native_object('user_profile', v_row);
  end if;
  return new;
end;
$$;

revoke all on function app.sync_person_object_from_membership() from public, anon, authenticated;

create trigger organization_membership_object_sync
  after insert or update or delete on public.organization_membership
  for each row execute function app.sync_person_object_from_membership();

create or replace function app.sync_person_object_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.object o
  set title = coalesce(nullif(btrim(new.full_name), ''), new.email, '')
  where o.id = new.id
    and o.type_id in (select t.id from public.object_type t where t.key = 'person');
  return new;
end;
$$;

revoke all on function app.sync_person_object_title() from public, anon, authenticated;

create trigger user_profile_object_title
  after update of full_name, email on public.user_profile
  for each row
  when (old.full_name is distinct from new.full_name or old.email is distinct from new.email)
  execute function app.sync_person_object_title();

-- ---------------------------------------------------------------------------
-- Backfill, parents first
-- ---------------------------------------------------------------------------

select app.upsert_native_object('meeting', to_jsonb(r)) from public.meeting r;
select app.upsert_native_object('decision', to_jsonb(r)) from public.decision r;
select app.upsert_native_object('risk', to_jsonb(r)) from public.risk r;
select app.upsert_native_object('outcome_metric', to_jsonb(r)) from public.outcome_metric r;
select app.upsert_native_object('team', to_jsonb(r)) from public.team r;
select app.upsert_native_object('event', to_jsonb(r)) from public.event r;
select app.upsert_native_object('crm_contact', to_jsonb(r)) from public.crm_contact r;
select app.upsert_native_object('document', to_jsonb(r)) from public.document r;
select app.upsert_native_object('user_profile', app.person_object_row(m))
from public.organization_membership m
where app.person_object_row(m) is not null;
