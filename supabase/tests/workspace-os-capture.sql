-- Capture inbox (M18): every active member has a personal inbox that nobody
-- else can read or change; what was captured is fixed; filing and dismissing
-- are updates by the owner. Every role, allow and deny. Rolled back.
begin;

create function tests.capture_raises(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege or check_violation or not_null_violation then
  return true;
end;
$$;
grant execute on function tests.capture_raises(text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_people uuid[];
  v_org uuid;
  v_person uuid;
  v_item uuid;
  v_count integer;
  v_updated integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  v_people := array[v_owner, v_admin, v_staff, v_volunteer, v_guest, v_accountant];

  update public.organization_membership set role = 'guest'
  where organization_id = v_org and user_id = v_accountant;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '1 day', v_admin);

  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.capture_item'::regclass),
    'capture_item has row-level security'
  );
  perform tests.ok(
    (select p.proconfig @> array['search_path=""'] from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'capture_item_guard'),
    'capture_item_guard has an empty search_path'
  );

  -- Everyone captures into their own inbox.
  foreach v_person in array v_people loop
    perform tests.authenticate(v_person);
    -- The body marks this file's rows, so rows already in the database
    -- (from a browser run, say) do not change the counts.
    insert into public.capture_item (organization_id, owner_id, kind, title, body)
    values (v_org, v_person, 'text', 'Call the venue', 'capture-test');
    insert into public.capture_item (organization_id, owner_id, kind, title, url, body)
    values (v_org, v_person, 'link', 'Venue page', 'https://example.org/venue', 'capture-test');
    select count(*) into v_count from public.capture_item where body = 'capture-test';
    perform tests.ok(v_count = 2, format('%s reads exactly their own two items (%s)', v_person, v_count));
    reset role;
  end loop;

  -- Nobody reads, changes or deletes anyone else's, not even the owner.
  foreach v_person in array v_people loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.capture_item where owner_id <> v_person;
    perform tests.ok(v_count = 0, format('%s reads no one else''s inbox', v_person));
    update public.capture_item set title = 'hijacked' where owner_id <> v_person;
    get diagnostics v_updated = row_count;
    perform tests.ok(v_updated = 0, format('%s changes no one else''s items', v_person));
    delete from public.capture_item where owner_id <> v_person;
    get diagnostics v_updated = row_count;
    perform tests.ok(v_updated = 0, format('%s deletes no one else''s items', v_person));
    perform tests.ok(
      tests.capture_raises(format(
        'insert into public.capture_item (organization_id, owner_id, kind, title) values (%L, %L, ''text'', ''planted'')',
        v_org, case when v_person = v_owner then v_staff else v_owner end)),
      format('%s cannot put an item in someone else''s inbox', v_person));
    reset role;
  end loop;
  select count(*) into v_count from public.capture_item where title = 'hijacked';
  perform tests.ok(v_count = 0, 'no item was changed by another person');
  select count(*) into v_count from public.capture_item where body = 'capture-test';
  perform tests.ok(v_count = 12, 'every item survived the other people''s deletes');

  -- The owner files and dismisses; the origin cannot change; bad items are refused.
  perform tests.authenticate(v_volunteer);
  select id into v_item from public.capture_item where kind = 'text' and body = 'capture-test' limit 1;
  update public.capture_item
  set status = 'filed', filed_as = 'task', filed_ref_id = gen_random_uuid(), filed_at = now()
  where id = v_item;
  perform tests.ok((select status from public.capture_item where id = v_item) = 'filed', 'the owner files an item');
  perform tests.ok(
    tests.capture_raises(format('update public.capture_item set kind = ''link'', url = ''https://x.org'' where id = %L', v_item)),
    'what was captured cannot be changed');
  perform tests.ok(
    tests.capture_raises(format('update public.capture_item set owner_id = %L where id = %L', v_owner, v_item)),
    'an item cannot be handed to someone else');
  perform tests.ok(
    tests.capture_raises(format('update public.capture_item set status = ''filed'', filed_as = null where id = %L', v_item)),
    'a filed item must say what it was filed as');
  perform tests.ok(
    tests.capture_raises(format(
      'insert into public.capture_item (organization_id, owner_id, kind, title) values (%L, %L, ''link'', ''No url'')',
      v_org, v_volunteer)),
    'a link needs its address');
  perform tests.ok(
    tests.capture_raises(format(
      'insert into public.capture_item (organization_id, owner_id, kind, title, url) values (%L, %L, ''link'', ''Bad'', ''javascript:alert(1)'')',
      v_org, v_volunteer)),
    'only http and https links are kept');
  perform tests.ok(
    tests.capture_raises(format(
      'insert into public.capture_item (organization_id, owner_id, kind, title, status, filed_as, filed_at) values (%L, %L, ''text'', ''Pre-filed'', ''filed'', ''task'', now())',
      v_org, v_volunteer)),
    'an item starts in the inbox');
  delete from public.capture_item where id = v_item;
  perform tests.ok(not exists (select 1 from public.capture_item where id = v_item), 'the owner deletes their own item');
  reset role;

  -- A deactivated member reads and captures nothing.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_staff;
  perform tests.authenticate(v_staff);
  select count(*) into v_count from public.capture_item;
  perform tests.ok(v_count = 0, 'a deactivated member reads no items, not even their own');
  perform tests.ok(
    tests.capture_raises(format(
      'insert into public.capture_item (organization_id, owner_id, kind, title) values (%L, %L, ''text'', ''late'')', v_org, v_staff)),
    'a deactivated member cannot capture');
  reset role;
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.capture_raises('select count(*) from public.capture_item'),
    'a signed-out visitor cannot read the capture inbox'
  );
  perform tests.ok(
    tests.capture_raises(
      'insert into public.capture_item (organization_id, owner_id, kind, title) values (gen_random_uuid(), gen_random_uuid(), ''text'', ''x'')'),
    'a signed-out visitor cannot capture'
  );
  reset role;
end;
$$;

rollback;
