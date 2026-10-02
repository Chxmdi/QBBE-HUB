-- Workspace OS synced blocks (U5b): a synced block is read and written as its
-- source document is, and someone who cannot open the source can ask to read
-- it. Run after qa-users.sql and rls.sql. Rolled back.
begin;

create or replace function tests.synced_visible(p_id uuid)
returns boolean
language plpgsql
as $$
begin
  return exists (select 1 from public.synced_block where id = p_id);
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function tests.synced_update_allowed(p_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.synced_block
  set content = '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"probe"}]}]}'::jsonb
  where id = p_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function tests.synced_insert_allowed(p_page uuid, p_as uuid)
returns boolean
language plpgsql
as $$
begin
  insert into public.synced_block (organization_id, source_object_id, source_object_type, source_block_id, created_by)
  select m.organization_id, p_page, 'page', 'probe-' || gen_random_uuid(), p_as
  from public.organization_membership m where m.user_id = p_as limit 1;
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function tests.synced_request(p_id uuid, p_status text default 'requested')
returns boolean
language plpgsql
as $$
begin
  insert into public.synced_block_access_request (synced_block_id, requester_id, organization_id, status)
  select p_id, auth.uid(), m.organization_id, p_status
  from public.organization_membership m where m.user_id = auth.uid() limit 1;
  return true;
exception when insufficient_privilege or foreign_key_violation then
  return false;
end;
$$;

create or replace function tests.synced_decide(p_id uuid, p_requester uuid, p_status text)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.synced_block_access_request set status = p_status
  where synced_block_id = p_id and requester_id = p_requester;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
exception when insufficient_privilege or check_violation then
  return false;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_other_org uuid;
  p_shared uuid;
  p_private uuid;
  s_shared uuid;
  s_private uuid;
  v_person uuid;
  v_ok boolean;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer'
  where user_id = v_viewer and organization_id = v_org;
  insert into public.organization (name, slug) values ('Other org', 'other-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Synced shared') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_staff, 'Synced private') returning id into p_private;

  -- The organization comes from the source, whatever the caller sends.
  insert into public.synced_block (organization_id, source_object_id, source_object_type, source_block_id, created_by, content)
  values (v_other_org, p_shared, 'page', 'b-shared', v_owner,
          '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Opening hours"}]}]}'::jsonb)
  returning id into s_shared;
  insert into public.synced_block (organization_id, source_object_id, source_object_type, source_block_id, created_by)
  values (v_org, p_private, 'page', 'b-private', v_staff)
  returning id into s_private;

  perform tests.ok(
    (select organization_id from public.synced_block where id = s_shared) = v_org,
    'synced block: takes its source''s organization'
  );
  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.synced_block'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.synced_block_access_request'::regclass)
      and not has_table_privilege('authenticated', 'public.synced_block', 'delete')
      and not has_table_privilege('authenticated', 'public.synced_block_access_request', 'delete')
      and not has_table_privilege('anon', 'public.synced_block', 'select')
      and not has_table_privilege('anon', 'public.synced_block_access_request', 'select'),
    'synced block: RLS on both tables; no delete; nothing for signed-out'
  );
  perform tests.ok(
    (select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
     where p.pronamespace = 'app'::regnamespace
       and p.proname in ('can_synced_source', 'synced_block_granted', 'synced_block_before_write',
                         'synced_block_access_request_before_write')),
    'synced block: definer functions pin an empty search_path'
  );

  -- Reading follows the source ---------------------------------------------------
  foreach v_person in array array[v_owner, v_admin, v_staff, v_viewer] loop
    perform tests.authenticate(v_person, 'aal1');
    v_ok := tests.synced_visible(s_shared);
    reset role;
    perform tests.ok(v_ok, 'synced block: ' || v_person || ' reads a block whose source page they can read');
  end loop;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person);
    v_ok := tests.synced_visible(s_shared);
    reset role;
    perform tests.ok(not v_ok, 'synced block: ' || v_person || ' cannot read a block whose source page they cannot read');
  end loop;

  perform tests.authenticate(v_staff);
  v_ok := tests.synced_visible(s_private);
  reset role;
  perform tests.ok(v_ok, 'synced block: the private page''s owner reads its block');

  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    v_ok := tests.synced_visible(s_private);
    reset role;
    perform tests.ok(not v_ok, 'synced block: ' || v_person || ' cannot read a block from someone else''s private page');
  end loop;

  -- Writing follows the source -------------------------------------------------------
  foreach v_person in array array[v_staff, v_owner] loop
    perform tests.authenticate(v_person, 'aal2');
    v_ok := tests.synced_update_allowed(s_shared) and tests.synced_insert_allowed(p_shared, v_person);
    reset role;
    perform tests.ok(v_ok, 'synced block: ' || v_person || ' creates and edits a block on a page they can edit');
  end loop;

  foreach v_person in array array[v_volunteer, v_guest, v_viewer] loop
    perform tests.authenticate(v_person);
    v_ok := tests.synced_update_allowed(s_shared) or tests.synced_insert_allowed(p_shared, v_person);
    reset role;
    perform tests.ok(not v_ok, 'synced block: ' || v_person || ' cannot create or edit a block on a page they cannot edit');
  end loop;

  perform tests.ok(
    (select content #>> '{blocks,0,content,0,text}' from public.synced_block where id = s_shared) = 'probe'
      and (select updated_by from public.synced_block where id = s_shared) is not null,
    'synced block: an edit writes through to the one shared row'
  );

  perform tests.authenticate(v_owner, 'aal2');
  begin
    update public.synced_block set source_object_id = p_private where id = s_shared;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'synced block: a block cannot move to another source');

  -- Request flow -------------------------------------------------------------------------
  perform tests.authenticate(v_volunteer);
  v_ok := tests.synced_request(s_shared, 'granted');
  reset role;
  perform tests.ok(not v_ok, 'synced block: a request cannot be filed as already granted');

  perform tests.authenticate(v_volunteer);
  v_ok := tests.synced_request(s_shared);
  reset role;
  perform tests.ok(v_ok, 'synced block: a member who cannot read the source asks for access');

  perform tests.ok(
    (select organization_id = v_org and decided_by is null
     from public.synced_block_access_request where synced_block_id = s_shared and requester_id = v_volunteer),
    'synced block: the request takes the block''s organization'
  );

  perform tests.authenticate(v_volunteer);
  v_ok := tests.synced_visible(s_shared)
    or tests.synced_decide(s_shared, v_volunteer, 'granted');
  reset role;
  perform tests.ok(not v_ok, 'synced block: a pending request opens nothing, and the requester cannot grant it');

  perform tests.authenticate(v_volunteer);
  v_ok := exists (select 1 from public.synced_block_access_request where synced_block_id = s_shared);
  reset role;
  perform tests.ok(v_ok, 'synced block: the requester sees their own request');

  perform tests.authenticate(v_viewer, 'aal1');
  v_ok := exists (select 1 from public.synced_block_access_request where synced_block_id = s_shared)
    or tests.synced_decide(s_shared, v_volunteer, 'granted');
  reset role;
  perform tests.ok(not v_ok, 'synced block: a reader who cannot edit the source neither sees nor decides requests');

  perform tests.authenticate(v_owner, 'aal2');
  v_ok := tests.synced_decide(s_shared, v_volunteer, 'requested');
  reset role;
  perform tests.ok(not v_ok, 'synced block: a decision is granted or declined');

  perform tests.authenticate(v_owner, 'aal2');
  v_ok := tests.synced_decide(s_shared, v_volunteer, 'granted');
  reset role;
  perform tests.ok(v_ok, 'synced block: an editor of the source grants the request');
  perform tests.ok(
    (select decided_by = v_owner and decided_at is not null
     from public.synced_block_access_request where synced_block_id = s_shared and requester_id = v_volunteer),
    'synced block: the database records who decided'
  );

  perform tests.authenticate(v_volunteer);
  v_ok := tests.synced_visible(s_shared) and not tests.synced_update_allowed(s_shared);
  reset role;
  perform tests.ok(v_ok, 'synced block: a granted request lets the requester read the block, not edit it');

  perform tests.authenticate(v_volunteer);
  v_ok := exists (select 1 from public.editor_document where object_id = p_shared)
    or exists (select 1 from public.page where id = p_shared);
  reset role;
  perform tests.ok(not v_ok, 'synced block: a granted request opens nothing else of the source');

  -- Declined: nothing opens.
  perform tests.authenticate(v_owner);
  v_ok := tests.synced_request(s_private);
  reset role;
  perform tests.authenticate(v_staff, 'aal2');
  v_ok := v_ok and tests.synced_decide(s_private, v_owner, 'declined');
  reset role;
  perform tests.authenticate(v_owner);
  v_ok := v_ok and not tests.synced_visible(s_private);
  reset role;
  perform tests.ok(v_ok, 'synced block: a declined request opens nothing');

  perform tests.authenticate(v_admin, 'aal2');
  v_ok := tests.synced_decide(s_private, v_owner, 'granted');
  reset role;
  perform tests.ok(not v_ok, 'synced block: only someone who can edit the source decides');

  -- Signed out ---------------------------------------------------------------------------
  perform tests.clear_auth();
  v_ok := tests.synced_visible(s_shared) or tests.synced_update_allowed(s_shared);
  reset role;
  perform tests.ok(not v_ok, 'synced block: signed-out cannot read or write');

  begin
    insert into public.synced_block (organization_id, source_object_id, source_object_type, source_block_id, created_by)
    values (v_org, gen_random_uuid(), 'page', 'nowhere', v_owner);
    v_ok := true;
  exception when foreign_key_violation then
    v_ok := false;
  end;
  perform tests.ok(not v_ok, 'synced block: a block needs an existing source');
end;
$$;

rollback;
