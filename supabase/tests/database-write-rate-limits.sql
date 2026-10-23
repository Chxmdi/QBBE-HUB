-- Write limits enforced in the database for the tables people can write to
-- directly (SEC-024): past its limit in a window, a person's next insert is
-- refused with SQLSTATE RL429; the limit is per person and per window; the
-- service role, jobs, the database's own functions and imports granted an
-- allowance are not held to it. Run after qa-users.sql and rls.sql. Rolled
-- back.
begin;

-- Counter state for one action and person, at the current window.
create or replace function tests.write_limit_fill(p_action text, p_user uuid, p_used integer)
returns void
language sql
as $$
  insert into public.rate_limit_counter (bucket, window_start, count)
  select 'db:' || p_action || ':' || p_user,
         to_timestamp(floor(extract(epoch from now()) / r.window_seconds) * r.window_seconds),
         p_used
  from app_limits.rule r where r.action = p_action
  on conflict (bucket, window_start) do update set count = excluded.count;
$$;

create or replace function tests.write_limit_age(p_action text, p_user uuid)
returns void
language sql
as $$
  update public.rate_limit_counter set window_start = window_start - interval '1 day'
  where bucket = 'db:' || p_action || ':' || p_user;
$$;

-- An insert made inside a function of the database's own, as a fan-out does.
create or replace function tests.capture_as_definer(p_org uuid, p_owner uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.capture_item (organization_id, owner_id, kind, title, body)
  values (p_org, p_owner, 'text', 'From a database function', 'x');
$$;
grant execute on function tests.capture_as_definer(uuid, uuid) to authenticated;

do $$
declare
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_limit integer;
  v_done integer := 0;
  v_state text;
  v_trigger record;
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_form uuid;
  v_left integer;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_guest limit 1;
  select max_count into strict v_limit from app_limits.rule where action = 'capture:create';

  -- 1,000 captures as the guest: the limit's worth go in, the next is refused.
  perform tests.authenticate(v_guest, 'aal1');
  begin
    for i in 1..1000 loop
      insert into public.capture_item (organization_id, owner_id, kind, title, body)
      values (v_org, v_guest, 'text', 'Note ' || i, 'x');
      v_done := i;
    end loop;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_done = v_limit and v_state = 'RL429',
    format('write limits: %s captures go in, the next is refused with RL429 (in %s, got %s)', v_limit, v_done, v_state));

  -- Another person is not held to the guest's count.
  perform tests.authenticate(v_staff, 'aal2');
  insert into public.capture_item (organization_id, owner_id, kind, title, body)
  values (v_org, v_staff, 'text', 'Someone else', 'x');
  perform tests.clear_auth();
  reset role;
  perform tests.ok(true, 'write limits: one person''s limit does not hold back another');

  -- The database's own functions, the service role and jobs are exempt.
  perform tests.authenticate(v_guest, 'aal1');
  perform tests.capture_as_definer(v_org, v_guest);
  perform tests.clear_auth();
  reset role;
  perform tests.ok(true, 'write limits: an insert inside a database function is not counted');
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  insert into public.capture_item (organization_id, owner_id, kind, title, body)
  values (v_org, v_guest, 'text', 'By the service role', 'x');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.capture_item (organization_id, owner_id, kind, title, body)
  values (v_org, v_guest, 'text', 'By a job', 'x');
  perform tests.ok(true, 'write limits: the service role and jobs are not counted');

  -- The window resets.
  perform tests.write_limit_age('capture:create', v_guest);
  perform tests.authenticate(v_guest, 'aal1');
  insert into public.capture_item (organization_id, owner_id, kind, title, body)
  values (v_org, v_guest, 'text', 'Next window', 'x');
  perform tests.clear_auth();
  reset role;
  perform tests.ok(true, 'write limits: a new window starts a new count');

  -- An import is granted room for its rows by the server, and no more.
  perform tests.write_limit_fill('capture:create', v_guest, v_limit);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  perform public.grant_write_allowance(v_guest, 'capture:create', 3, 600);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  v_done := 0;
  v_state := null;
  perform tests.authenticate(v_guest, 'aal1');
  begin
    for i in 1..10 loop
      insert into public.capture_item (organization_id, owner_id, kind, title, body)
      values (v_org, v_guest, 'text', 'Imported ' || i, 'x');
      v_done := i;
    end loop;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_done = 3 and v_state = 'RL429',
    format('write limits: an allowance of 3 lets 3 more in, then refuses (in %s, got %s)', v_done, v_state));
  perform tests.authenticate(v_guest, 'aal1');
  begin
    perform public.grant_write_allowance(v_guest, 'capture:create', 1000, 600);
    perform tests.ok(false, 'write limits: nobody signed in grants themselves an allowance');
  exception when insufficient_privilege then
    perform tests.ok(true, 'write limits: nobody signed in grants themselves an allowance');
  end;
  perform tests.clear_auth();
  reset role;

  -- Notifications sent straight from the API are held to their limit too.
  perform tests.write_limit_fill('notification:create', v_guest, (select max_count from app_limits.rule where action = 'notification:create'));
  perform tests.authenticate(v_guest, 'aal1');
  begin
    insert into public.notification (organization_id, user_id, category, title)
    values (v_org, v_guest, 'mention', 'One too many');
    v_state := 'inserted';
  exception when others then
    v_state := sqlstate;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_state = 'RL429', format('write limits: a notification past the limit is refused (got %s)', v_state));

  -- A form submitted through the database function people call is counted
  -- per call, though the function writes as its owner.
  perform tests.authenticate(v_admin, 'aal2');
  insert into public.form_v2 (organization_id, type_key, title_en, title_fr, properties)
  values (v_org, 'write_limit_offer', 'Limit offer', 'Offre limite', jsonb_build_array(
    jsonb_build_object('key', 'name', 'kind', 'text', 'required', false,
      'label', jsonb_build_object('en', 'Name', 'fr', 'Nom'))))
  returning id into v_form;
  update public.form_v2 set status = 'published' where id = v_form;
  perform tests.clear_auth();
  reset role;
  perform tests.authenticate(v_volunteer, 'aal1');
  perform public.submit_form_v2(v_form, jsonb_build_object('name', 'Within the limit'));
  perform tests.clear_auth();
  reset role;
  perform tests.write_limit_fill('form:submit', v_volunteer, (select max_count from app_limits.rule where action = 'form:submit'));
  perform tests.authenticate(v_volunteer, 'aal1');
  begin
    perform public.submit_form_v2(v_form, jsonb_build_object('name', 'One too many'));
    v_state := 'submitted';
  exception when others then
    v_state := sqlstate;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_state = 'RL429'
      and (select count(*) from public.form_v2_response where form_id = v_form) = 1,
    format('write limits: a form submitted through its database function past the limit is refused, and nothing is created (got %s)', v_state));

  -- Room granted twice is the larger of the two, never their sum.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  perform public.grant_write_allowance(v_staff, 'task:create', 100, 600);
  perform public.grant_write_allowance(v_staff, 'task:create', 50, 600);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select remaining into v_left from app_limits.allowance where user_id = v_staff and action = 'task:create';
  perform tests.ok(v_left = 100, format('write limits: a second allowance never adds to the first (got %s)', v_left));

  perform tests.ok(
    not has_table_privilege('authenticated', 'public.rate_limit_counter', 'insert')
      and not has_table_privilege('authenticated', 'public.rate_limit_counter', 'delete')
      and not has_table_privilege('authenticated', 'public.rate_limit_counter', 'select')
      and not has_table_privilege('anon', 'public.rate_limit_counter', 'select'),
    'write limits: nobody signed in reads or writes the counters');

  -- Sending someone the same notification again re-opens it: counted too.
  -- The recipient reading their own is not.
  perform tests.authenticate(v_staff, 'aal2');
  perform public.create_notifications(jsonb_build_array(jsonb_build_object(
    'user_id', v_volunteer, 'organization_id', v_org, 'category', 'mention',
    'title', 'First', 'dedupe_key', 'write-limit-reopen')));
  perform tests.clear_auth();
  reset role;
  perform tests.write_limit_fill('notification:create', v_staff, (select max_count from app_limits.rule where action = 'notification:create'));
  perform tests.authenticate(v_staff, 'aal2');
  begin
    perform public.create_notifications(jsonb_build_array(jsonb_build_object(
      'user_id', v_volunteer, 'organization_id', v_org, 'category', 'mention',
      'title', 'Rewritten', 'dedupe_key', 'write-limit-reopen')));
    v_state := 'reopened';
  exception when others then
    v_state := sqlstate;
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_state = 'RL429'
      and (select title from public.notification where dedupe_key = 'write-limit-reopen' and user_id = v_volunteer) = 'First',
    format('write limits: re-opening someone else''s notification past the limit is refused (got %s)', v_state));
  perform tests.write_limit_fill('notification:create', v_volunteer, (select max_count from app_limits.rule where action = 'notification:create'));
  perform tests.authenticate(v_volunteer, 'aal1');
  update public.notification set read_at = now() where dedupe_key = 'write-limit-reopen' and user_id = v_volunteer;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(true, 'write limits: reading one''s own notification is not counted');

  -- Every table in the package carries the trigger, with its action.
  for v_trigger in
    select * from (values
      ('notification', 'notification:create'), ('record_comment', 'comment:create'),
      ('capture_item', 'capture:create'), ('form_submission', 'form:submit'),
      ('task', 'task:create'), ('document', 'document:upload'), ('page', 'page:create'),
      ('form_v2_response', 'form:submit'), ('approval_event', 'comment:create'),
      ('approval_delegation', 'approval:delegate')
    ) as t(tbl, action)
  loop
    perform tests.ok(exists (
        select 1 from pg_trigger g
        where g.tgrelid = ('public.' || v_trigger.tbl)::regclass and not g.tgisinternal
          and g.tgfoid = 'app_limits.enforce_insert_rate_limit()'::regprocedure
          and split_part(encode(g.tgargs, 'escape'), '\000', 1) = v_trigger.action
      ) and exists (select 1 from app_limits.rule where action = v_trigger.action),
      format('write limits: %s inserts count against %s', v_trigger.tbl, v_trigger.action));
  end loop;

  -- What signed-in people can reach, and what they cannot.
  perform tests.ok(
    not has_table_privilege('authenticated', 'app_limits.rule', 'select')
      and not has_table_privilege('authenticated', 'app_limits.allowance', 'select')
      and not has_function_privilege('authenticated', 'public.grant_write_allowance(uuid, text, integer, integer)', 'execute')
      and not has_function_privilege('anon', 'public.grant_write_allowance(uuid, text, integer, integer)', 'execute')
      and has_function_privilege('service_role', 'public.grant_write_allowance(uuid, text, integer, integer)', 'execute')
      and not has_function_privilege('anon', 'app_limits.count_insert(text)', 'execute')
      and (select relrowsecurity from pg_class where oid = 'app_limits.rule'::regclass)
      and (select relrowsecurity from pg_class where oid = 'app_limits.allowance'::regclass),
    'write limits: rules and allowances are hidden; only the service role grants an allowance');
end;
$$;

rollback;
