-- Email retries (migration 20261124000000). Proves a failed send is retried
-- over several hours instead of five tries two minutes apart, and that an
-- administrator can put the last week's failed emails back in the queue:
-- only their own organization's, only failed ones (never bounced or sent),
-- each once, with an audit row. Run after qa-users.sql and rls.sql. All
-- changes are rolled back.
begin;

do $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_other_org uuid;
  v_failed uuid;
  v_old uuid;
  v_bounced uuid;
  v_elsewhere uuid;
  v_abandoned uuid;
  v_read uuid;
  v_note uuid;
  v_count integer;
  v_queued bigint;
  v_row record;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_admin;
  insert into organization (name, slug) values ('Retry fixture org', 'retry-' || gen_random_uuid()::text)
  returning id into v_other_org;

  perform tests.ok(
    (select max_attempts from public.job_definition where name = 'drain-notifications') = 8
      and (select max_attempts from public.job_definition where name = 'retry-failed-emails') = 8,
    'email sends get eight attempts, spread over hours by the drain job');

  -- System email unless stated, so only the rule under test decides. Rolled back.
  alter table email_delivery alter column kind set default 'system';
  insert into email_delivery (organization_id, recipient, subject, dedupe_key, status, attempt, last_error)
  values (v_org, 'a@example.test', 's', 'retry-test-' || gen_random_uuid(), 'failed', 8, 'provider down')
  returning id into v_failed;
  insert into email_delivery (organization_id, recipient, subject, dedupe_key, status, attempt, updated_at)
  values (v_org, 'b@example.test', 's', 'retry-test-' || gen_random_uuid(), 'failed', 8, now() - interval '8 days')
  returning id into v_old;
  insert into email_delivery (organization_id, recipient, subject, dedupe_key, status, attempt)
  values (v_org, 'c@example.test', 's', 'retry-test-' || gen_random_uuid(), 'bounced', 1)
  returning id into v_bounced;
  insert into email_delivery (organization_id, recipient, subject, dedupe_key, status, attempt)
  values (v_other_org, 'd@example.test', 's', 'retry-test-' || gen_random_uuid(), 'failed', 8)
  returning id into v_elsewhere;

  insert into email_delivery (organization_id, recipient, subject, dedupe_key, status, attempt, last_error)
  values (v_org, 'e@example.test', 's', 'retry-test-' || gen_random_uuid(), 'failed', 8, 'Gave up after 8 attempts.')
  returning id into v_abandoned;
  insert into notification (organization_id, user_id, category, title, read_at)
  values (v_org, v_admin, 'assignment', 'Already read', now())
  returning id into v_note;
  insert into email_delivery (organization_id, recipient, subject, dedupe_key, status, attempt, kind, notification_id)
  values (v_org, 'f@example.test', 's', 'retry-test-' || gen_random_uuid(), 'failed', 8, 'notification', v_note)
  returning id into v_read;

  perform tests.ok(not has_function_privilege('anon', 'public.requeue_failed_email_deliveries(uuid)', 'execute'),
    'signed-out visitors cannot re-queue email');

  perform tests.authenticate(v_staff, 'aal2');
  perform tests.ok(tests.permission_denied(format('select public.requeue_failed_email_deliveries(%L)', v_org)),
    'a member who is not an administrator cannot re-queue email');
  perform tests.authenticate(v_admin, 'aal1');
  perform tests.ok(tests.permission_denied(format('select public.requeue_failed_email_deliveries(%L)', v_org)),
    'an administrator without the second factor cannot re-queue email');
  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(tests.permission_denied(format('select public.requeue_failed_email_deliveries(%L)', v_other_org)),
    'an administrator cannot re-queue another organization''s email');

  reset role;
  select count(*) into v_queued from pgmq.q_notifications;
  set local role authenticated;
  v_count := public.requeue_failed_email_deliveries(v_org);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  perform tests.ok(v_count = 1, format('only the recent failed email is re-queued (%s: %s)', v_count, (select string_agg(recipient || '/' || kind, ',') from email_delivery where organization_id = v_org and status = 'queued' and attempt = 0)));
  select status, attempt, last_error into v_row from email_delivery where id = v_failed;
  perform tests.ok(v_row.status = 'queued' and v_row.attempt = 0 and v_row.last_error is null,
    'the re-queued email starts a fresh set of attempts');
  perform tests.ok((select status from email_delivery where id = v_old) = 'failed', 'a failure older than a week is left alone');
  perform tests.ok((select status from email_delivery where id = v_bounced) = 'bounced', 'a bounced address is never retried');
  perform tests.ok((select status from email_delivery where id = v_elsewhere) = 'failed', 'another organization''s email is untouched');
  perform tests.ok((select status from email_delivery where id = v_abandoned) = 'failed',
    'an email the stuck-email sweep gave up on is not sent again (it may have gone out)');
  perform tests.ok((select status from email_delivery where id = v_read) = 'failed',
    'a notification email whose notification was already read is not sent again');
  perform tests.ok(
    (select count(*) from pgmq.q_notifications) = v_queued + 1
      and exists (select 1 from pgmq.q_notifications q
                  where q.message ->> 'delivery_id' = v_failed::text and q.message ->> 'kind' = 'retry'),
    'one queue message is added for the re-queued email');
  perform tests.ok(exists (
      select 1 from audit_event where organization_id = v_org and actor_id = v_admin
        and action = 'failed_emails_requeued' and (metadata ->> 'count')::int = 1),
    'the re-queue is recorded in the audit log');

  perform tests.authenticate(v_admin, 'aal2');
  set local role authenticated;
  v_count := public.requeue_failed_email_deliveries(v_org);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform tests.ok(v_count = 0, 'running it again re-queues nothing twice');
end;
$$;

rollback;
