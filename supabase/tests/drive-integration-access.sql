-- INT-DRIVE: a connected user's Drive mirror must not widen Google metadata
-- to unrelated QBBE members merely because they share an organization.
begin;
do $$
declare
  admin_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  connected_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  unrelated_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  org uuid;
  connection uuid;
  drive_doc uuid;
  n int;
begin
  select organization_id into strict org
    from public.organization_membership
    where user_id = connected_user
    limit 1;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  insert into public.integration_connection(
    organization_id, user_id, provider, status
  ) values (
    org, connected_user, 'google_drive', 'connected'
  ) returning id into connection;

  insert into public.document(
    organization_id, title, kind, url, visibility,
    owner_id, created_by, integration_connection_id, external_id
  ) values (
    org,
    'Private Drive mirror row',
    'link',
    'https://drive.google.com/file/d/private-drive-fixture/view',
    'private',
    connected_user,
    connected_user,
    connection,
    'private-drive-fixture'
  ) returning id into drive_doc;

  perform tests.authenticate(connected_user);
  select count(*) into n from public.document where id = drive_doc;
  perform tests.ok(n = 1, 'the connected user can read their imported Drive metadata');

  perform tests.authenticate(unrelated_member);
  select count(*) into n from public.document where id = drive_doc;
  perform tests.ok(n = 0, 'an unrelated organization member cannot read another user''s Drive metadata');

  perform tests.authenticate(admin_user);
  select count(*) into n from public.document where id = drive_doc;
  perform tests.ok(n = 1, 'an organization administrator retains recovery visibility');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
