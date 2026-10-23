-- Write limits enforced in the database for the tables people can write to
-- directly (SEC-024).
--
-- The app limits how fast a person creates things (src/lib/rate-limit.ts),
-- but a signed-in person can also insert through the database API directly,
-- past those checks. Inserts into the tables below now count against the
-- same per-person limits, under the same action names and values
-- (tests/unit/rate-limit-shared.test.ts keeps app_limits.rule and
-- RATE_LIMITS equal). Their counters are kept apart from the app's
-- ("db:<action>:<user>"), so a write through the app is not counted twice.
--
-- Past the limit in a window, the insert is refused with SQLSTATE RL429,
-- which the app shows as "too many changes, try again shortly".
--
-- Not counted on these tables: the service role, jobs, the seed script and
-- the database's own functions writing them (an announcement's fan-out).
-- The database functions a signed-in person calls to submit a form, comment
-- on or delegate an approval are counted per call instead, on the table each
-- writes its one record to (form_v2_response, approval_event,
-- approval_delegation), whoever runs the insert.
-- Server actions that legitimately write many rows at once (an import, a
-- bulk assignment, closing a project) are first granted room for them by
-- the server (public.grant_write_allowance, service role only).
--
-- These live in their own schema, app_limits: signed-in people need to
-- reach the counting function from the trigger, and the app schema is
-- closed to them; app_limits is not served by the API.

create schema if not exists app_limits;
revoke all on schema app_limits from public, anon;
grant usage on schema app_limits to authenticated, service_role;

create table app_limits.rule (
  action text primary key,
  max_count integer not null check (max_count > 0),
  window_seconds integer not null check (window_seconds > 0)
);
comment on table app_limits.rule is
  'Per-person insert limits enforced in the database; the same names and values as RATE_LIMITS in src/lib/rate-limit.ts.';
alter table app_limits.rule enable row level security;
revoke all on table app_limits.rule from public, anon, authenticated, service_role;

insert into app_limits.rule (action, max_count, window_seconds) values
  ('message:create', 120, 60),
  ('task:create', 120, 60),
  ('document:upload', 60, 3600),
  ('form:submit', 60, 3600),
  ('page:create', 60, 60),
  ('comment:create', 60, 60),
  ('capture:create', 60, 60),
  ('notification:create', 600, 60),
  ('approval:delegate', 30, 3600);

-- Room the server grants one person, for one action, for a short while.
create table app_limits.allowance (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null references app_limits.rule (action),
  remaining integer not null check (remaining >= 0),
  expires_at timestamptz not null,
  primary key (user_id, action)
);
alter table app_limits.allowance enable row level security;
revoke all on table app_limits.allowance from public, anon, authenticated, service_role;

create or replace function app_limits.count_insert(p_action text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rule app_limits.rule;
  v_allowed boolean;
begin
  if v_uid is null then
    return;
  end if;
  select * into v_rule from app_limits.rule r where r.action = p_action;
  if not found then
    return;
  end if;
  select h.allowed into v_allowed
  from app.rate_limit_hit('db:' || p_action || ':' || v_uid, v_rule.max_count, v_rule.window_seconds) h;
  if v_allowed then
    return;
  end if;
  update app_limits.allowance a
  set remaining = a.remaining - 1
  where a.user_id = v_uid and a.action = p_action and a.remaining > 0 and a.expires_at > now();
  if found then
    return;
  end if;
  -- Refusing undoes this insert's count too, so the counter stays at the limit.
  raise exception 'rate_limited: too many changes in a short time'
    using errcode = 'RL429', hint = p_action;
end;
$$;
revoke all on function app_limits.count_insert(text) from public, anon, authenticated, service_role;
grant execute on function app_limits.count_insert(text) to authenticated;

create or replace function app_limits.enforce_insert_rate_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 'direct' (the default): only an insert made by a signed-in person's own
  -- request; the service role, jobs and the database's own functions run as
  -- other roles. 'any': every insert on behalf of a signed-in person, for
  -- tables written once per call by functions people call themselves.
  if current_user = 'authenticated'
     or (coalesce(tg_argv[1], 'direct') = 'any'
         and auth.uid() is not null
         and coalesce(auth.jwt() ->> 'role', '') <> 'service_role') then
    perform app_limits.count_insert(tg_argv[0]);
  end if;
  return new;
end;
$$;
revoke all on function app_limits.enforce_insert_rate_limit() from public, anon, authenticated, service_role;

create trigger notification_write_limit before insert on public.notification
  for each row execute function app_limits.enforce_insert_rate_limit('notification:create');
create trigger record_comment_write_limit before insert on public.record_comment
  for each row execute function app_limits.enforce_insert_rate_limit('comment:create');
create trigger capture_item_write_limit before insert on public.capture_item
  for each row execute function app_limits.enforce_insert_rate_limit('capture:create');
create trigger form_submission_write_limit before insert on public.form_submission
  for each row execute function app_limits.enforce_insert_rate_limit('form:submit');
create trigger task_write_limit before insert on public.task
  for each row execute function app_limits.enforce_insert_rate_limit('task:create');
create trigger document_write_limit before insert on public.document
  for each row execute function app_limits.enforce_insert_rate_limit('document:upload');
create trigger page_write_limit before insert on public.page
  for each row execute function app_limits.enforce_insert_rate_limit('page:create');
create trigger form_v2_response_write_limit before insert on public.form_v2_response
  for each row execute function app_limits.enforce_insert_rate_limit('form:submit', 'any');
create trigger approval_event_write_limit before insert on public.approval_event
  for each row execute function app_limits.enforce_insert_rate_limit('comment:create', 'any');
create trigger approval_delegation_write_limit before insert on public.approval_delegation
  for each row execute function app_limits.enforce_insert_rate_limit('approval:delegate', 'any');

-- A notification sent again (same dedupe key) is re-opened rather than
-- inserted: counted the same, when someone changes a notification that is
-- not their own. A person reading or clearing their own is not counted.
create or replace function app_limits.count_notification_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.user_id is distinct from auth.uid()
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    perform app_limits.count_insert('notification:create');
  end if;
  return new;
end;
$$;
revoke all on function app_limits.count_notification_change() from public, anon, authenticated, service_role;
create trigger notification_reopen_write_limit before update on public.notification
  for each row execute function app_limits.count_notification_change();

-- TODO(SEC-024, message-privacy): the chat message table (public.message)
-- gets its insert limit together with the message-privacy package
-- (PRIV-004/005), which changes who can insert there. Its rule
-- ('message:create') is already above; once that package lands, add:
--   create trigger message_write_limit before insert on public.message
--     for each row execute function app_limits.enforce_insert_rate_limit('message:create');

create or replace function public.grant_write_allowance(
  p_user uuid, p_action text, p_count integer, p_seconds integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Only the server grants write allowances' using errcode = '42501';
  end if;
  if p_user is null or p_count is null or p_count < 1 or p_count > 5000
     or p_seconds is null or p_seconds < 1 or p_seconds > 3600 then
    raise exception 'A write allowance is 1 to 5000 writes for at most an hour' using errcode = '22023';
  end if;
  -- The larger of any room still open and this grant: room never adds up
  -- across requests.
  insert into app_limits.allowance as a (user_id, action, remaining, expires_at)
  values (p_user, p_action, p_count, now() + make_interval(secs => p_seconds))
  on conflict (user_id, action) do update
    set remaining = greatest(case when a.expires_at > now() then a.remaining else 0 end, excluded.remaining),
        expires_at = greatest(a.expires_at, excluded.expires_at);
end;
$$;
revoke all on function public.grant_write_allowance(uuid, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.grant_write_allowance(uuid, text, integer, integer) to service_role;

-- Counters are written only through app.rate_limit_hit, never by people.
revoke all on table public.rate_limit_counter from anon, authenticated;
