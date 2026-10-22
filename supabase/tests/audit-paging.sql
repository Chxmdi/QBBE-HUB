-- The admin audit log pages newest first by (created_at, id) with a keyset
-- cursor, the filter src/features/admin/audit-cursor.ts builds: events that
-- share one timestamp across a page boundary are neither repeated nor
-- skipped. Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_tied timestamptz := '2001-01-01 12:00:00.123456+00';
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_page uuid[];
  v_seen uuid[] := '{}';
  v_expected uuid[];
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  -- 75 events old enough to be the only ones on these pages: 45 share one timestamp.
  delete from audit_event where organization_id = v_org;
  insert into audit_event (organization_id, actor_type, event_type, action, object_type, created_at)
  select v_org, 'system', 'zzpaging', 'probe', 'organization',
         case when g <= 10 then v_tied + interval '1 hour' when g <= 55 then v_tied else v_tied - interval '1 hour' end
  from generate_series(1, 75) g;

  perform tests.authenticate(v_owner, 'aal2');
  select array_agg(id order by created_at desc, id desc) into v_expected from audit_event;
  loop
    select array_agg(id order by created_at desc, id desc) into v_page from (
      select id, created_at from audit_event
      where v_cursor_at is null
         or created_at < v_cursor_at
         or (created_at = v_cursor_at and id < v_cursor_id)
      order by created_at desc, id desc
      limit 31) p;
    v_seen := v_seen || coalesce(v_page[1:30], '{}');
    exit when coalesce(cardinality(v_page), 0) <= 30;
    select created_at, id into v_cursor_at, v_cursor_id from audit_event where id = v_page[30];
  end loop;
  perform tests.clear_auth();
  reset role;

  perform tests.ok(cardinality(v_expected) = 75, 'audit paging fixture: the admin reads the 75 events');
  perform tests.ok(v_seen = v_expected,
    'audit paging: events sharing one timestamp across a page boundary are neither repeated nor skipped');
end;
$$;

rollback;
