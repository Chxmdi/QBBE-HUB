-- Workspace OS blocks (M4c): block rows are derived from the saved document,
-- rebuilt on every save, readable exactly by the people who can read the
-- object, and never written through the API. Run after qa-users.sql and
-- rls.sql. Rolled back.
begin;

create or replace function tests.block_count(p_object uuid)
returns integer
language plpgsql
as $$
begin
  return (select count(*) from public.block where object_id = p_object);
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
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  p_shared uuid;
  p_private uuid;
  v_target uuid := gen_random_uuid();
  v_file uuid := gen_random_uuid();
  v_person uuid;
  v_n integer;
  v_ok boolean;
  v_row record;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer'
  where user_id = v_viewer and organization_id = v_org;

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Shared') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_volunteer, 'Mine') returning id into p_private;

  insert into public.editor_document (object_id, object_type, organization_id, created_by, content)
  values (p_shared, 'page', v_org, v_owner, jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
    jsonb_build_object('id', 'h', 'type', 'heading', 'props', jsonb_build_object('level', 2),
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Agenda'))),
    jsonb_build_object('id', 'l', 'type', 'bulletListItem',
      'content', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', 'See '),
        jsonb_build_object('type', 'link', 'href', 'https://x.org',
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'the plan')))),
      'children', jsonb_build_array(
        jsonb_build_object('id', 'c', 'type', 'paragraph',
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Réviser le budget'))))),
    jsonb_build_object('id', 't', 'type', 'table', 'content', jsonb_build_object('type', 'tableContent', 'rows', jsonb_build_array(
      jsonb_build_object('cells', jsonb_build_array(
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'a')),
        jsonb_build_object('type', 'tableCell', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'b')))))))),
    jsonb_build_object('id', 'task', 'type', 'task', 'props', jsonb_build_object('objectId', v_target::text)),
    jsonb_build_object('id', 'img', 'type', 'image', 'props', jsonb_build_object('url', 'qbbe-document:' || v_file::text)),
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'no id')))
  )));

  insert into public.editor_document (object_id, object_type, organization_id, created_by, content)
  values (p_private, 'page', v_org, v_volunteer, '{"version":1,"blocks":[{"id":"p","type":"paragraph","content":[{"type":"text","text":"secret"}]}]}');

  -- Derivation -----------------------------------------------------------------
  perform tests.ok((select count(*) from public.block where object_id = p_shared) = 7,
    'blocks: one row per block, children included');
  perform tests.ok(
    (select array_agg(block_id order by position) from public.block where object_id = p_shared and block_id <> md5(p_shared::text || '000006'))
      = array['h', 'l', 'c', 't', 'task', 'img'],
    'blocks: positions follow document order, depth first');
  select * into v_row from public.block where object_id = p_shared and block_id = 'c';
  perform tests.ok(v_row.parent_block_id = 'l' and v_row.depth = 1 and v_row.text = 'Réviser le budget',
    'blocks: a child block records its parent, depth and text');
  perform tests.ok((select text from public.block where object_id = p_shared and block_id = 'l') = 'See the plan',
    'blocks: link text is part of the block text');
  perform tests.ok((select text from public.block where object_id = p_shared and block_id = 't') = E'a\tb',
    'blocks: table cells are read as text');
  perform tests.ok(
    (select referenced_object_id = v_target and referenced_kind = 'object' from public.block where object_id = p_shared and block_id = 'task'),
    'blocks: a semantic block records the object it is');
  perform tests.ok(
    (select referenced_object_id = v_file and referenced_kind = 'document' from public.block where object_id = p_shared and block_id = 'img'),
    'blocks: a file block records its library document');
  perform tests.ok(
    exists (select 1 from public.block where object_id = p_shared and block_id = md5(p_shared::text || '000006') and text = 'no id'),
    'blocks: a block without an id gets a stable one');
  perform tests.ok(
    exists (select 1 from public.block where object_id = p_shared and search_vector @@ to_tsquery('french', 'budget')),
    'blocks: block text is searchable');

  -- Rebuilt on save --------------------------------------------------------------
  perform tests.authenticate(v_staff);
  update public.editor_document
  set content = '{"version":1,"blocks":[{"id":"only","type":"quote","content":[{"type":"text","text":"Rewritten"}]}]}'
  where object_id = p_shared;
  reset role;
  perform tests.ok(
    (select count(*) = 1 and bool_and(block_id = 'only' and type = 'quote' and text = 'Rewritten')
     from public.block where object_id = p_shared),
    'blocks: saving replaces the rows with the new document''s');

  -- Yjs state is stored and size-checked -----------------------------------------
  perform tests.authenticate(v_staff);
  update public.editor_document set yjs_state = '\x0102'::bytea where object_id = p_shared;
  reset role;
  perform tests.ok((select yjs_state = '\x0102'::bytea from public.editor_document where object_id = p_shared),
    'blocks: the editor''s Yjs state is saved with the document');

  -- Who can read -------------------------------------------------------------------
  foreach v_person in array array[v_owner, v_admin, v_staff, v_viewer] loop
    perform tests.authenticate(v_person, 'aal1');
    v_n := tests.block_count(p_shared);
    reset role;
    perform tests.ok(v_n = 1, 'blocks: ' || v_person || ' reads a workspace page''s blocks');
  end loop;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person);
    v_n := tests.block_count(p_shared);
    reset role;
    perform tests.ok(v_n = 0, 'blocks: ' || v_person || ' cannot read a workspace page''s blocks');
  end loop;

  perform tests.authenticate(v_volunteer);
  v_n := tests.block_count(p_private);
  reset role;
  perform tests.ok(v_n = 1, 'blocks: the volunteer reads their private page''s blocks');

  foreach v_person in array array[v_owner, v_admin, v_staff, v_viewer, v_guest] loop
    perform tests.authenticate(v_person);
    v_n := tests.block_count(p_private);
    reset role;
    perform tests.ok(v_n = 0, 'blocks: ' || v_person || ' cannot read someone else''s private blocks');
  end loop;

  perform tests.clear_auth();
  v_n := tests.block_count(p_shared);
  reset role;
  perform tests.ok(v_n <= 0, 'blocks: signed-out reads nothing');

  -- Nobody writes blocks directly ------------------------------------------------------
  foreach v_person in array array[v_owner, v_staff] loop
    perform tests.authenticate(v_person);
    begin
      insert into public.block (object_id, block_id, organization_id, object_type, type, position, depth)
      values (p_shared, 'forged', v_org, 'page', 'paragraph', 99, 0);
      v_ok := true;
    exception when insufficient_privilege then
      v_ok := false;
    end;
    reset role;
    perform tests.ok(not v_ok, 'blocks: ' || v_person || ' cannot write block rows directly');
  end loop;

  perform tests.ok(
    not has_table_privilege('authenticated', 'public.block', 'update')
      and not has_table_privilege('authenticated', 'public.block', 'delete'),
    'blocks: no update or delete through the API');
  perform tests.ok(
    (select proconfig @> array['search_path=""'] from pg_proc where oid = 'app.derive_blocks()'::regprocedure),
    'blocks: the derivation function pins an empty search_path');
end;
$$;

rollback;
