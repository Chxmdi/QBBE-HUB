-- INT-EMAIL: the bounce/complaint suppression list spans organizations, so
-- nobody reads or writes it through the API, administrators included.
begin;
do $$
declare
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  member_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  n int;
  denied boolean;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.email_suppression (address, reason, provider_event_id)
  values ('bounced-fixture@example.com', 'bounced', 'evt-fixture');

  perform tests.authenticate(admin_user, 'aal2');
  set local role authenticated;
  select count(*) into n from public.email_suppression where address = 'bounced-fixture@example.com';
  perform tests.ok(n = 0, 'an organization administrator cannot read the cross-organization suppression list');

  reset role;
  perform tests.authenticate(member_user);
  set local role authenticated;
  select count(*) into n from public.email_suppression;
  perform tests.ok(n = 0, 'a member cannot read the suppression list');

  denied := false;
  begin
    insert into public.email_suppression (address, reason) values ('someone@example.com', 'complained');
  exception when insufficient_privilege then denied := true;
  end;
  perform tests.ok(denied, 'a member cannot add an address to the suppression list');

  denied := false;
  begin
    delete from public.email_suppression where address = 'bounced-fixture@example.com';
    get diagnostics n = row_count;
    denied := n = 0;
  exception when insufficient_privilege then denied := true;
  end;
  perform tests.ok(denied, 'a member cannot lift a suppression');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
