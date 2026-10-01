-- Workspace OS operation-based saves (U3): append_editor_operations bumps
-- the version and re-derives blocks, refuses a stale base and a stranger,
-- and keeps the last 200 operations. Run after qa-users.sql and rls.sql.
-- Rolled back.
begin;

-- Appends one replace operation as the current session; returns the new
-- version, or a negative code: -1 forbidden, -2 conflict, -3 other error.
create or replace function tests.editor_append(p_object uuid, p_type text, p_base integer, p_text text)
returns integer
language plpgsql
as $$
declare
  v_version integer;
begin
  select version into v_version
  from public.append_editor_operations(
    p_object, p_type, p_base,
    jsonb_build_array(jsonb_build_object(
      'kind', 'replace',
      'content', jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
        jsonb_build_object('id', 'n1', 'type', 'paragraph',
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text))))),
      'state', null)));
  return v_version;
exception
  when insufficient_privilege then return -1;
  when serialization_failure then return -2;
  when others then return -3;
end;
$$;

create or replace function tests.editor_ops_visible(p_object uuid)
returns integer
language plpgsql
as $$
begin
  return (select count(*) from public.editor_operation where object_id = p_object);
exception when insufficient_privilege then
  return -1;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  p_shared uuid;
  p_fresh uuid;
  v_meeting uuid;
  v_before integer;
  v_result integer;
  v_second integer;
  v_n integer;
  i integer;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Shared') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Fresh') returning id into p_fresh;
  insert into public.editor_document (object_id, object_type, organization_id, created_by, content)
  values (p_shared, 'page', v_org, v_owner, jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
    jsonb_build_object('id', 'o1', 'type', 'paragraph',
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Old text'))))));
  select version into v_before from public.editor_document where object_id = p_shared;

  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.editor_operation'::regclass)
      and not has_table_privilege('authenticated', 'public.editor_operation', 'update')
      and not has_table_privilege('authenticated', 'public.editor_operation', 'delete')
      and not has_table_privilege('anon', 'public.editor_operation', 'select')
      and not has_function_privilege('anon', 'public.append_editor_operations(uuid, text, integer, jsonb)', 'execute'),
    'editor ops: RLS on; no update or delete; nothing for signed-out'
  );
  perform tests.ok(
    (select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
     where (p.pronamespace = 'public'::regnamespace and p.proname = 'append_editor_operations')
        or (p.pronamespace = 'app'::regnamespace and p.proname in ('editor_block_text', 'editor_content_text'))),
    'editor ops: definer and helper functions pin an empty search_path'
  );

  -- Append bumps the version, stores the operation and re-derives blocks -------
  perform tests.authenticate(v_staff, 'aal2');
  v_result := tests.editor_append(p_shared, 'page', v_before, 'New text');
  reset role;
  perform tests.ok(v_result = v_before + 1, 'editor ops: an append on the current version bumps it by one');
  perform tests.ok(
    (select content_text from public.editor_document where object_id = p_shared) = 'New text',
    'editor ops: the document text follows the applied operation'
  );
  perform tests.ok(
    exists (select 1 from public.block where object_id = p_shared and block_id = 'n1' and text = 'New text')
      and not exists (select 1 from public.block where object_id = p_shared and block_id = 'o1'),
    'editor ops: the block table is re-derived from the applied operation'
  );
  perform tests.ok(
    (select count(*) from public.editor_operation where object_id = p_shared) = 1
      and (select seq from public.editor_operation where object_id = p_shared) = 1
      and (select base_version from public.editor_operation where object_id = p_shared) = v_before
      and (select actor_id from public.editor_operation where object_id = p_shared) = v_staff
      and (select organization_id from public.editor_operation where object_id = p_shared) = v_org,
    'editor ops: the operation row records sequence, base version, actor and organization'
  );

  -- A stale base raises a conflict and changes nothing --------------------------
  perform tests.authenticate(v_owner, 'aal2');
  v_second := tests.editor_append(p_shared, 'page', v_before, 'Stale text');
  reset role;
  perform tests.ok(v_second = -2, 'editor ops: a stale base version raises a conflict');
  perform tests.ok(
    (select version from public.editor_document where object_id = p_shared) = v_before + 1
      and (select content_text from public.editor_document where object_id = p_shared) = 'New text'
      and (select count(*) from public.editor_operation where object_id = p_shared) = 1,
    'editor ops: a conflicting append changes neither the document nor the log'
  );

  perform tests.authenticate(v_owner, 'aal2');
  v_second := tests.editor_append(p_shared, 'page', v_before + 1, 'Owner text');
  reset role;
  perform tests.ok(
    v_second = v_before + 2 and (select max(seq) from public.editor_operation where object_id = p_shared) = 2,
    'editor ops: an append on the new version succeeds with the next sequence'
  );

  -- A stranger is denied -----------------------------------------------------------
  perform tests.authenticate(v_volunteer);
  v_result := tests.editor_append(p_shared, 'page', v_before + 2, 'Volunteer text');
  v_n := tests.editor_ops_visible(p_shared);
  reset role;
  perform tests.ok(v_result = -1, 'editor ops: a volunteer cannot append to a workspace page');
  perform tests.ok(v_n = 0, 'editor ops: a volunteer sees no operations of a workspace page');
  perform tests.ok(
    (select content_text from public.editor_document where object_id = p_shared) = 'Owner text',
    'editor ops: a denied append changes nothing'
  );

  perform tests.authenticate(v_volunteer);
  begin
    insert into public.editor_operation (object_id, object_type, organization_id, seq, base_version, ops, actor_id)
    values (p_shared, 'page', v_org, 99, 1, '[{"kind":"replace"}]'::jsonb, v_volunteer);
    v_result := 1;
  exception when insufficient_privilege then
    v_result := -1;
  end;
  reset role;
  perform tests.ok(v_result = -1, 'editor ops: a volunteer cannot write the log directly');

  perform tests.clear_auth();
  v_result := tests.editor_append(p_shared, 'page', v_before + 2, 'Anonymous text');
  reset role;
  perform tests.ok(v_result = -1, 'editor ops: signed-out cannot append');

  perform tests.authenticate(v_staff, 'aal2');
  v_n := tests.editor_ops_visible(p_shared);
  reset role;
  perform tests.ok(v_n = 2, 'editor ops: staff read the log of a page they can read');

  -- A first save creates the document ---------------------------------------------
  perform tests.authenticate(v_staff, 'aal2');
  v_result := tests.editor_append(p_fresh, 'page', null, 'First text');
  reset role;
  perform tests.ok(
    v_result = 1 and (select content_text from public.editor_document where object_id = p_fresh) = 'First text'
      and (select created_by from public.editor_document where object_id = p_fresh) = v_staff,
    'editor ops: a first append creates the document at version 1'
  );
  perform tests.authenticate(v_staff, 'aal2');
  v_result := tests.editor_append(p_fresh, 'page', null, 'Second first text');
  reset role;
  perform tests.ok(v_result = -2, 'editor ops: a second "first save" is a conflict, not an overwrite');

  perform tests.authenticate(v_staff, 'aal2');
  v_result := tests.editor_append(gen_random_uuid(), 'page', null, 'Nowhere');
  reset role;
  perform tests.ok(v_result = -1, 'editor ops: an unknown object is refused');

  -- Meeting notes follow the meeting: its organizer appends, an attendee cannot --
  insert into public.meeting (organization_id, title, organizer_id, starts_at)
  values (v_org, 'Queue meeting', v_staff, now()) returning id into v_meeting;
  insert into public.meeting_attendee (meeting_id, user_id) values (v_meeting, v_volunteer);

  perform tests.authenticate(v_staff, 'aal2');
  v_result := tests.editor_append(v_meeting, 'meeting', null, 'Meeting notes');
  reset role;
  perform tests.ok(
    v_result = 1 and (select notes from public.meeting where id = v_meeting) = 'Meeting notes',
    'editor ops: the organizer appends meeting notes, and meeting.notes follows'
  );

  perform tests.authenticate(v_volunteer);
  v_result := tests.editor_append(v_meeting, 'meeting', 1, 'Attendee notes');
  v_n := tests.editor_ops_visible(v_meeting);
  reset role;
  perform tests.ok(v_result = -1 and v_n = 1, 'editor ops: an attendee reads the meeting log but cannot append');

  -- Retention: the last 200 operations per object -----------------------------------
  perform tests.authenticate(v_staff, 'aal2');
  v_result := 1;
  for i in 1..210 loop
    v_result := tests.editor_append(p_fresh, 'page', v_result, 'Edit ' || i);
    exit when v_result < 0;
  end loop;
  reset role;
  perform tests.ok(v_result = 211, 'editor ops: 210 further appends all land in order');
  perform tests.ok(
    (select count(*) from public.editor_operation where object_id = p_fresh) = 200
      and (select min(seq) from public.editor_operation where object_id = p_fresh) = 12
      and (select max(seq) from public.editor_operation where object_id = p_fresh) = 211,
    'editor ops: only the last 200 operations are kept'
  );
end;
$$;

rollback;
