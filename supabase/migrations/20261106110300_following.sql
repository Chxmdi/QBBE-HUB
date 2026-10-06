-- Workspace OS following and notification rules (V1-14, stream S6b, epic #199).
--
-- A person follows an object (a task or a project today: whatever public.can
-- answers for) or a saved query, and sets one rule per kind of change: status,
-- assignment, dates, comments and any other change. Each rule says whether
-- the change shows in the Hub and how it is emailed: at once, in the daily
-- digest, in the weekly digest, or not at all.
--
-- It builds on the existing notifications feature rather than beside it:
--   * changes become ordinary `notification` rows, category `follow_<kind>`,
--     with a dedupe key, so the existing drain, quiet hours, suppression list
--     and non-production recipient allow-list all apply unchanged;
--   * the email choice is written into notification_preference.category_modes
--     (by trigger, so the rule table stays the one place people edit), which
--     is what the existing digest job reads to hold a category for the daily
--     or weekly digest.
--
-- The fan-out job reads activity_event (the event stream until object_event,
-- M9a) as the service role and checks each follower with public.can_as, so a
-- person is never told about something they cannot open.
--
-- Hidden behind the wos_objects switch in the app (no separate switch exists).

create table public.follow_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade default auth.uid(),
  object_id uuid,
  object_type text check (object_type is null or object_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  query_spec jsonb,
  label text check (label is null or char_length(label) <= 200),
  created_at timestamptz not null default now(),
  constraint follow_v2_one_target check ((object_id is null) <> (query_spec is null)),
  constraint follow_v2_object_typed check ((object_id is null) = (object_type is null)),
  constraint follow_v2_query_shape check (
    query_spec is null or coalesce(jsonb_typeof(query_spec) = 'object'
      and query_spec->>'version' = '1'
      and jsonb_typeof(query_spec->'types') = 'array'
      and pg_column_size(query_spec) <= 8192, false))
);

create unique index uq_follow_v2_object on public.follow_v2 (user_id, object_id) where object_id is not null;
create index idx_follow_v2_object on public.follow_v2 (object_id) where object_id is not null;
create index idx_follow_v2_queries on public.follow_v2 (organization_id) where query_spec is not null;

comment on table public.follow_v2 is
  'Workspace OS following (V1-14): a person follows an object or a saved query.';

create table public.follow_rule_v2 (
  user_id uuid not null references public.user_profile (id) on delete cascade default auth.uid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  event_kind text not null check (event_kind in ('status', 'assignment', 'due', 'comment', 'change')),
  in_app boolean not null default true,
  email text not null default 'off' check (email in ('immediate', 'daily', 'weekly', 'off')),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_kind)
);

comment on table public.follow_rule_v2 is
  'Per-person rules for followed changes. Missing rows mean the defaults in src/features/following/rules.ts.';

-- How far the fan-out has read activity_event. Service role only.
create table public.follow_event_cursor (
  consumer text primary key,
  last_created_at timestamptz not null default '-infinity',
  last_id uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Keep the email choice where the digest and the drain already look
-- ---------------------------------------------------------------------------

create or replace function app.follow_rule_mirror() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_key text := 'follow_' || coalesce(new.event_kind, old.event_kind);
begin
  if tg_op = 'DELETE' then
    update public.notification_preference
    set category_modes = coalesce(category_modes, '{}'::jsonb) - v_key
    where user_id = v_user;
    return old;
  end if;
  new.updated_at := now();
  insert into public.notification_preference (user_id, category_modes)
  values (v_user, jsonb_build_object(v_key, new.email))
  on conflict (user_id) do update
    set category_modes = coalesce(public.notification_preference.category_modes, '{}'::jsonb)
      || jsonb_build_object(v_key, new.email);
  return new;
end;
$$;
revoke all on function app.follow_rule_mirror() from public, anon, authenticated;

create trigger follow_rule_v2_mirror
before insert or update on public.follow_rule_v2
for each row execute function app.follow_rule_mirror();

create trigger follow_rule_v2_mirror_delete
after delete on public.follow_rule_v2
for each row execute function app.follow_rule_mirror();

-- ---------------------------------------------------------------------------
-- Row-level security: each person manages only their own follows and rules
-- ---------------------------------------------------------------------------

alter table public.follow_v2 enable row level security;
alter table public.follow_rule_v2 enable row level security;
alter table public.follow_event_cursor enable row level security;
-- follow_event_cursor: no policies; only the job (service role) touches it.

create policy follow_v2_read on public.follow_v2
for select to authenticated using (
  user_id = (select auth.uid()) and app.is_org_member(organization_id)
);

-- Following an object needs the right to see it; a query is run as the
-- follower, so it needs nothing more than membership.
create policy follow_v2_insert on public.follow_v2
for insert to authenticated with check (
  user_id = (select auth.uid())
  and app.is_org_member(organization_id)
  and (object_id is null or public.can(object_id, 'view'))
);

create policy follow_v2_delete on public.follow_v2
for delete to authenticated using (
  user_id = (select auth.uid()) and app.is_org_member(organization_id)
);

create policy follow_rule_v2_read on public.follow_rule_v2
for select to authenticated using (
  user_id = (select auth.uid()) and app.is_org_member(organization_id)
);

create policy follow_rule_v2_insert on public.follow_rule_v2
for insert to authenticated with check (
  user_id = (select auth.uid()) and app.is_org_member(organization_id)
);

create policy follow_rule_v2_update on public.follow_rule_v2
for update to authenticated
using (user_id = (select auth.uid()) and app.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and app.is_org_member(organization_id));

create policy follow_rule_v2_delete on public.follow_rule_v2
for delete to authenticated using (
  user_id = (select auth.uid()) and app.is_org_member(organization_id)
);

grant select, insert, delete on public.follow_v2 to authenticated;
grant select, insert, update, delete on public.follow_rule_v2 to authenticated;
revoke all on public.follow_event_cursor from public, anon, authenticated;
revoke update on public.follow_v2 from anon, authenticated;
grant all on public.follow_v2, public.follow_rule_v2, public.follow_event_cursor to service_role;

-- ---------------------------------------------------------------------------
-- The fan-out job, every five minutes. It does nothing while wos_objects is off.
-- ---------------------------------------------------------------------------

insert into public.job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values
  ('follow-events',
   'Tells followers about changes to what they follow. Does nothing while wos_objects is off.',
   '*/5 * * * *', null, true, 200, 3)
on conflict (name) do update
  set description = excluded.description,
      schedule = excluded.schedule;

do $$
declare
  j record;
begin
  for j in select name, schedule from public.job_definition where name = 'follow-events'
  loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
