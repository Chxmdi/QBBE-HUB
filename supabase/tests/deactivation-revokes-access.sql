-- Deactivating a member ends their integrations in that organization: the
-- Google connection is disconnected, its stored tokens are deleted, and the
-- mailbox, calendar and Drive copies made through it are removed. When it
-- was their last active membership, their sign-in sessions end too.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  org uuid;
  v_conn uuid;
  v_doc uuid;
  n int;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;

  insert into public.integration_connection (organization_id, user_id, provider, status)
  values (org, staff_user, 'gmail', 'connected') returning id into v_conn;
  insert into public.integration_secret (connection_id, access_token, refresh_token)
  values (v_conn, 'enc:v1:00000000:iv:tag:access-dra', 'enc:v1:00000000:iv:tag:refresh-dra');
  insert into public.gmail_message (organization_id, user_id, connection_id, external_id, subject, snippet, from_address, received_at)
  values (org, staff_user, v_conn, 'dra-1', 'DRA subject', 'DRA snippet', 'someone@example.com', now());
  insert into public.calendar_event_link (organization_id, user_id, connection_id, external_id, title, starts_at)
  values (org, staff_user, v_conn, 'dra-ev-1', 'DRA event', now());
  insert into public.document (organization_id, title, kind, url, visibility, owner_id, created_by, integration_connection_id)
  values (org, 'DRA held drive file', 'link', 'https://drive.google.com/dra', 'private', staff_user, staff_user, v_conn)
  returning id into v_doc;
  insert into public.legal_hold (organization_id, scope, record_type, record_id, reason, placed_by)
  values (org, 'record', 'document', v_doc, 'DRA hold', owner_user);
  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), staff_user, now(), now());

  update public.organization_membership set status = 'deactivated', deactivated_at = now()
  where organization_id = org and user_id = staff_user;

  select count(*) into n from public.integration_connection where id = v_conn and status = 'disconnected';
  perform tests.ok(n = 1, 'the deactivated member''s connection is disconnected');
  select count(*) into n from public.integration_secret where connection_id = v_conn;
  perform tests.ok(n = 0, 'its stored tokens are deleted');
  select count(*) into n from public.gmail_message where connection_id = v_conn;
  perform tests.ok(n = 0, 'their mailbox copies are deleted');
  select count(*) into n from public.calendar_event_link where connection_id = v_conn;
  perform tests.ok(n = 0, 'their calendar copies are deleted');
  select count(*) into n from public.document where id = v_doc and integration_connection_id is null;
  perform tests.ok(n = 1, 'a held Drive document is kept, detached, and does not block deactivation');
  select count(*) into n from auth.sessions where user_id = staff_user;
  perform tests.ok(n = 0, 'their sign-in sessions end when no active membership remains');

  update public.organization_membership set status = 'active', deactivated_at = null
  where organization_id = org and user_id = staff_user;
  select count(*) into n from public.integration_connection where id = v_conn and status = 'disconnected';
  perform tests.ok(n = 1, 'reactivating does not reconnect anything by itself');
end;
$$;
rollback;
