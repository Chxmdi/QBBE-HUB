-- Transactional regressions; fixtures are rolled back.
begin;
create function tests.reject_scan_meeting_fixture() returns trigger language plpgsql as $$
begin raise exception 'Injected write failure' using errcode = '23514'; end;
$$;
create trigger reject_summary_fixture before insert on public.message
for each row when (new.body = 'FAIL_SUMMARY') execute function tests.reject_scan_meeting_fixture();
create trigger reject_action_fixture before insert on public.meeting_action
for each row when (new.title = 'FAIL_ACTION') execute function tests.reject_scan_meeting_fixture();
do $$
declare
  u uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  outsider uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  org uuid; doc uuid; channel_id uuid; m uuid; n int;
begin
  select organization_id into strict org from public.organization_membership where user_id = u limit 1;
  insert into storage.objects(bucket_id, name, owner_id) values ('documents', 'scan-regression/file.txt', u::text);
  perform tests.authenticate(u);
  insert into public.document(organization_id, title, kind, storage_path, owner_id, created_by)
    values(org, 'Scan regression', 'file', 'scan-regression/file.txt', u, u) returning id into doc;
  select count(*) into n from storage.objects where name = 'scan-regression/file.txt';
  perform tests.ok(n = 0, 'pending file cannot be read directly through Storage');
  begin
    update public.document set scan_status = 'clean' where id = doc;
    raise exception 'FAIL: caller certified own file';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  update public.document set scan_status = 'clean' where id = doc;
  perform tests.authenticate(u);
  select count(*) into n from storage.objects where name = 'scan-regression/file.txt';
  perform tests.ok(n = 1, 'clean file is available to its entitled reader');
  begin
    delete from storage.objects where name = 'scan-regression/file.txt';
    raise exception 'FAIL: caller could replace scanned bytes';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  update public.document set scan_status = 'quarantined', quarantined_at = now() where id = doc;
  perform tests.authenticate(u);
  select count(*) into n from storage.objects where name = 'scan-regression/file.txt';
  perform tests.ok(n = 0, 'quarantined file is denied through direct Storage access');
  begin
    update public.document set storage_path = 'different/file.txt' where id = doc;
    raise exception 'FAIL: caller swapped scanned object';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select id into channel_id from public.channel where organization_id = org and slug = 'general' limit 1;
  insert into public.meeting(organization_id, title, organizer_id, starts_at, channel_id)
    values(org, 'Atomic completion', u, now(), channel_id) returning id into m;
  perform tests.authenticate(outsider, 'aal1');
  begin
    perform public.complete_meeting(m, 'forbidden');
    raise exception 'FAIL: unassigned volunteer completed meeting';
  exception when insufficient_privilege then null; end;
  perform tests.authenticate(u);
  begin
    perform public.complete_meeting(m, 'FAIL_SUMMARY');
    raise exception 'FAIL: completion swallowed summary failure';
  exception when check_violation then null; end;
  perform tests.ok((select status <> 'completed' and summary_posted_at is null from public.meeting where id = m),
    'summary failure leaves the meeting incomplete');
  begin
    perform public.create_meeting_action(m, 'FAIL_ACTION', u, null);
    raise exception 'FAIL: action swallowed link failure';
  exception when check_violation then null; end;
  perform tests.ok((select count(*) = 0 from public.task where title = 'FAIL_ACTION'),
    'action-link failure rolls back task insertion');
  perform public.complete_meeting(m, 'Summary');
  perform public.complete_meeting(m, 'Summary retry');
  select count(*) into n from public.message where source_record_type = 'meeting' and source_record_id = m;
  perform tests.ok(n = 1, 'completion retry posts exactly one summary');
  perform tests.ok((select status = 'completed' and summary_posted_at is not null from public.meeting where id = m),
    'completion and summary marker persist together');
  -- Successful action creation persists both records.
  select count(*) into n from public.task where title = 'Atomic action';
  perform public.create_meeting_action(m, 'Atomic action', u, null);
  perform tests.ok((select count(*) = n + 1 from public.task where title = 'Atomic action'), 'meeting action creates a task');
  perform tests.ok((select count(*) = 1 from public.meeting_action where meeting_id = m and title = 'Atomic action'), 'task linked to meeting');
end;
$$;
rollback;
