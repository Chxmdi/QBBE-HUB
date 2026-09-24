-- Concurrency and idempotency under real parallel sessions (#111, QA-FINAL
-- "concurrency").
--
-- Every other file here runs in one session, which cannot race itself. This
-- one opens two more through dblink and makes them collide: session A starts a
-- write and holds its transaction open, session B issues the same write while
-- A's row is still uncommitted, then A commits and B finishes. That window, an
-- uncommitted duplicate, is exactly where a check-then-insert would let two
-- rows through, so each case asserts the single outcome the product promises.
--
-- The statements are the ones the application issues (see the file named in
-- each case), not reimplementations of them.
--
-- dblink sessions commit on their own, so unlike the rest of the suite this
-- file cannot roll back: it tags everything it creates and deletes it at the
-- end, and again at the start in case an earlier run died half way.

create extension if not exists dblink;

create or replace function tests.dblink_open(p_name text)
returns void
language plpgsql
set search_path = tests, public, extensions
as $$
begin
  if p_name = any (coalesce(dblink_get_connections(), '{}')) then
    perform dblink_disconnect(p_name);
  end if;
  -- Over the container's own network address, not loopback: loopback is
  -- `trust` in Supabase's pg_hba, and dblink refuses a non-superuser whose
  -- password the server never checked. scripts/test-db.mjs supplies the
  -- address as tests.race_host.
  perform dblink_connect(p_name, format(
    'dbname=postgres user=postgres password=postgres host=%s',
    current_setting('tests.race_host')));
end;
$$;

-- Starts `p_sql` in session B without waiting for it; it will block behind
-- session A's uncommitted row.
create or replace function tests.dblink_start(p_name text, p_sql text)
returns void
language plpgsql
set search_path = tests, public, extensions
as $$
begin
  if dblink_send_query(p_name, p_sql) <> 1 then
    raise exception 'could not start the query on %', p_name;
  end if;
end;
$$;

-- Waits for session B's statement and returns its row count, or the error it
-- raised. Anything left on the connection is drained so it can be reused.
create or replace function tests.dblink_finish(p_name text)
returns text
language plpgsql
set search_path = tests, public, extensions
as $$
declare
  v_status text;
begin
  select status into v_status from dblink_get_result(p_name, false) as r(status text);
  perform 1 from dblink_get_result(p_name, false) as r(status text);
  return v_status;
end;
$$;

-- Leftovers from an interrupted run.
delete from public.notification where dedupe_key like 'race-test:%';
delete from public.email_suppression where address like 'race-test-%@example.com';
delete from public.email_delivery where dedupe_key like 'race-test:%';
delete from public.task where title like 'race-test task%';
delete from public.project where name = 'race-test project';
delete from public.program where slug = 'race-test-program';
select pgmq.drop_queue('race_test') where exists (select 1 from pgmq.list_queues() where queue_name = 'race_test');

-- Committed before the races start: the other two sessions cannot see
-- anything this session has not committed.
select pgmq.create('race_test');
select public.job_queue_send('race_test', '{"race": true}'::jsonb, 0);
-- Its own program and project: CI runs this suite before the workspace is
-- seeded, so there may be no project to borrow.
insert into public.program (organization_id, name, slug, created_by)
select m.organization_id, 'race-test program', 'race-test-program',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
from public.organization_membership m
where m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
limit 1;
insert into public.project (organization_id, program_id, name, owner_id, created_by)
select p.organization_id, p.id, 'race-test project',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
from public.program p
where p.slug = 'race-test-program';
insert into public.task (organization_id, project_id, title, priority, created_by)
select p.organization_id, p.id, 'race-test task', 'medium', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
from public.project p
where p.name = 'race-test project';

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_task uuid;
  n integer;
  b_status text;
  v_title text;
  v_priority text;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  perform tests.dblink_open('race_a');
  perform tests.dblink_open('race_b');

  -- ---------------------------------------------------------------------
  -- 1. One notification per person per event (P0-NOT-04).
  --    src/features/jobs/services/notify.ts: upsert with
  --    onConflict user_id,dedupe_key, ignoreDuplicates.
  -- ---------------------------------------------------------------------
  perform dblink_exec('race_a', 'begin');
  perform dblink_exec('race_a', format(
    $q$insert into public.notification (user_id, organization_id, category, title, dedupe_key)
       values (%L, %L, 'system', 'race A', 'race-test:notify')
       on conflict (user_id, dedupe_key) do nothing$q$, v_owner, v_org));
  perform tests.dblink_start('race_b', format(
    $q$insert into public.notification (user_id, organization_id, category, title, dedupe_key)
       values (%L, %L, 'system', 'race B', 'race-test:notify')
       on conflict (user_id, dedupe_key) do nothing$q$, v_owner, v_org));
  perform dblink_exec('race_a', 'commit');
  b_status := tests.dblink_finish('race_b');

  select count(*) into n from public.notification where dedupe_key = 'race-test:notify';
  perform tests.ok(n = 1, 'a notification raised twice at once is stored once');
  perform tests.ok(b_status = 'INSERT 0 0',
    'the second writer of a duplicate notification is a quiet no-op, not an error (got ' || coalesce(b_status, 'null') || ')');

  -- ---------------------------------------------------------------------
  -- 2. A duplicate bounce webhook suppresses the address once.
  --    src/app/api/integrations/email/webhook/route.ts: upsert with
  --    onConflict address, ignoreDuplicates.
  -- ---------------------------------------------------------------------
  perform dblink_exec('race_a', 'begin');
  perform dblink_exec('race_a',
    $q$insert into public.email_suppression (address, reason, provider_event_id)
       values ('race-test-bounce@example.com', 'bounced', 'evt-a')
       on conflict (address) do nothing$q$);
  perform tests.dblink_start('race_b',
    $q$insert into public.email_suppression (address, reason, provider_event_id)
       values ('race-test-bounce@example.com', 'bounced', 'evt-b')
       on conflict (address) do nothing$q$);
  perform dblink_exec('race_a', 'commit');
  b_status := tests.dblink_finish('race_b');

  select count(*) into n from public.email_suppression where address = 'race-test-bounce@example.com';
  perform tests.ok(n = 1, 'a bounce delivered twice at once suppresses the address once');
  perform tests.ok(b_status = 'INSERT 0 0', 'the duplicate bounce is a quiet no-op');

  -- ---------------------------------------------------------------------
  -- 3. One email per dedupe key, even when two producers enqueue it at once.
  --    uq_email_delivery_dedupe.
  -- ---------------------------------------------------------------------
  perform dblink_exec('race_a', 'begin');
  perform dblink_exec('race_a', format(
    $q$insert into public.email_delivery (organization_id, recipient, subject, dedupe_key)
       values (%L, 'race-test-mail@example.com', 'race', 'race-test:mail')
       on conflict (dedupe_key) do nothing$q$, v_org));
  perform tests.dblink_start('race_b', format(
    $q$insert into public.email_delivery (organization_id, recipient, subject, dedupe_key)
       values (%L, 'race-test-mail@example.com', 'race', 'race-test:mail')
       on conflict (dedupe_key) do nothing$q$, v_org));
  perform dblink_exec('race_a', 'commit');
  b_status := tests.dblink_finish('race_b');

  select count(*) into n from public.email_delivery where dedupe_key = 'race-test:mail';
  perform tests.ok(n = 1, 'an email enqueued twice at once is sent once');

  -- ---------------------------------------------------------------------
  -- 4. A queued job message is handed to exactly one worker.
  --    job_queue_read wraps pgmq.read, which claims with SKIP LOCKED and a
  --    visibility timeout.
  -- ---------------------------------------------------------------------
  perform dblink_exec('race_a', 'begin');
  select count(*) into n
  from dblink('race_a', $q$select msg_id from public.job_queue_read('race_test', 60, 10)$q$) as r(msg_id bigint);
  perform tests.ok(n = 1, 'the first worker claims the queued message');

  select count(*) into n
  from dblink('race_b', $q$select msg_id from public.job_queue_read('race_test', 60, 10)$q$) as r(msg_id bigint);
  perform tests.ok(n = 0, 'a second worker reading at the same moment does not receive the claimed message');

  perform dblink_exec('race_a', 'commit');
  select count(*) into n
  from dblink('race_b', $q$select msg_id from public.job_queue_read('race_test', 60, 10)$q$) as r(msg_id bigint);
  perform tests.ok(n = 0, 'once claimed, the message stays with its worker until the visibility timeout');

  -- ---------------------------------------------------------------------
  -- 5. Two people editing different fields of one task at once: neither edit
  --    is lost. updateTask writes only the fields that changed, so the row
  --    lock serializes the two updates instead of one overwriting the other.
  -- ---------------------------------------------------------------------
  select id into strict v_task from public.task where title = 'race-test task';

  perform dblink_exec('race_a', 'begin');
  perform dblink_exec('race_a', format(
    $q$update public.task set title = 'race-test task renamed' where id = %L$q$, v_task));
  perform tests.dblink_start('race_b', format(
    $q$update public.task set priority = 'high' where id = %L$q$, v_task));
  perform dblink_exec('race_a', 'commit');
  b_status := tests.dblink_finish('race_b');

  select title, priority::text into v_title, v_priority from public.task where id = v_task;
  perform tests.ok(v_title = 'race-test task renamed' and v_priority = 'high',
    'concurrent edits to different fields of one task both survive');

  perform dblink_disconnect('race_a');
  perform dblink_disconnect('race_b');
end
$$;

delete from public.notification where dedupe_key like 'race-test:%';
delete from public.email_suppression where address like 'race-test-%@example.com';
delete from public.email_delivery where dedupe_key like 'race-test:%';
delete from public.task where title like 'race-test task%';
delete from public.project where name = 'race-test project';
delete from public.program where slug = 'race-test-program';
select pgmq.drop_queue('race_test');
