-- Workspace OS wave 2 unit X1: page export and import. Run after qa-users.sql
-- and rls.sql; everything is rolled back. X1 adds no table: export and import
-- read and write through the tables' own RLS as the signed-in person, so this
-- file proves those rules hold for exactly what the two routes do.
--
-- What must hold:
--   1. Export reads the page row and its editor_document as the exporter: a
--      person who cannot open a page reads neither (the route answers 404).
--   2. A view block's CSV comes from lens_query as the exporter: for every
--      fixture person at both sign-in levels, the rows are exactly the rows
--      RLS lets that person select, and two people get different files.
--   3. Import writes a page and its body as the importer: someone who may not
--      create a page in an area is refused, and nobody can write a body for a
--      page that is not theirs to edit.
--   4. The export's audit record can only be written in one's own
--      organization, and a non-admin cannot read it back.
begin;

create or replace function tests.x1_page_insert_allowed(p_org uuid, p_visibility text, p_by uuid)
returns boolean
language plpgsql
as $$
begin
  insert into public.page (organization_id, title, visibility, created_by, position)
  values (p_org, 'X1 import probe', p_visibility, p_by, 1);
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function tests.x1_body_insert_allowed(p_org uuid, p_page uuid, p_by uuid)
returns boolean
language plpgsql
as $$
begin
  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  values (p_page, 'page', p_org, '{"version":1,"blocks":[]}', '', p_by);
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function tests.x1_audit_insert_allowed(p_org uuid, p_actor uuid)
returns boolean
language plpgsql
as $$
begin
  insert into public.audit_event (organization_id, actor_id, event_type, action, object_type, object_id, metadata)
  values (p_org, p_actor, 'data_export', 'page_exported', 'page', gen_random_uuid(), '{}');
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_readonly uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_shared uuid;
  v_private uuid;
  v_view jsonb := '{"version":2,"source":{"type":"task"},"where":[{"path":"title","op":"starts_with","value":"X1 export"}],"fields":["status"]}';
  -- What the export route runs for that block (composeSpec, without the screen's row cap).
  v_spec jsonb := '{"version":1,"type":"task","where":{"and":[{"property":"title","operator":"starts_with","value":"X1 export"}]},"select":["status"]}';
  v_person uuid;
  v_level text;
  v_rows text[];
  v_direct text[];
  v_sizes integer[] := array[]::integer[];
begin
  select organization_id into v_org from public.organization_membership where user_id = v_staff;

  -- Fixtures, written as the database owner.
  insert into public.page (organization_id, title, visibility, created_by, position)
  values (v_org, 'X1 shared page', 'workspace', v_staff, 1) returning id into v_shared;
  insert into public.page (organization_id, title, visibility, created_by, position)
  values (v_org, 'X1 private page', 'private', v_staff, 1) returning id into v_private;
  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  select p, 'page', v_org,
    jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
      jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Secret plans'))),
      jsonb_build_object('type', 'query', 'props', jsonb_build_object('preset', 'my_open', 'spec', v_view::text)))),
    'Secret plans', v_staff
  from unnest(array[v_shared, v_private]) p;
  insert into public.task (organization_id, title, created_by, assignee_id, status, priority)
  values
    (v_org, 'X1 export one', v_owner, v_owner, 'ready', 'high'),
    (v_org, 'X1 export two', v_owner, v_staff, 'ready', 'low'),
    (v_org, 'X1 export three', v_staff, v_volunteer, 'in_progress', 'medium');

  -- 1. Reading the page to export it.
  perform tests.authenticate(v_staff);
  perform tests.ok((select count(*) from public.page where id in (v_shared, v_private)) = 2,
    'the author reads both pages to export them');
  perform tests.ok((select count(*) from public.editor_document where object_id in (v_shared, v_private)) = 2,
    'the author reads both bodies to export them');
  reset role;

  foreach v_person in array array[v_volunteer, v_guest, v_owner] loop
    perform tests.authenticate(v_person);
    perform tests.ok(not exists (select 1 from public.page where id = v_private),
      format('%s cannot read someone else''s private page, so its export is refused', v_person));
    perform tests.ok(not exists (select 1 from public.editor_document where object_id = v_private),
      format('%s cannot read the private page''s body', v_person));
    reset role;
  end loop;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person);
    perform tests.ok(not exists (select 1 from public.page where id = v_shared)
      and not exists (select 1 from public.editor_document where object_id = v_shared),
      format('%s cannot read a workspace page or its body, so its export is refused', v_person));
    reset role;
  end loop;

  -- 2. A view block's rows are the exporter's own.
  for v_person in select distinct user_id from public.organization_membership where organization_id = v_org loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      select coalesce(array_agg(r ->> 'id' order by r ->> 'id'), array[]::text[]) into v_rows
      from jsonb_array_elements(public.lens_query(v_spec) -> 'rows') r;
      select coalesce(array_agg(id::text order by id::text), array[]::text[]) into v_direct
      from public.task where title like 'X1 export%';
      perform tests.ok(v_rows = v_direct,
        format('%s at %s: the view''s CSV rows are exactly the tasks they can open (%s)', v_person, v_level, cardinality(v_direct)));
      v_sizes := v_sizes || cardinality(v_rows);
      reset role;
    end loop;
  end loop;
  perform tests.ok((select max(s) from unnest(v_sizes) s) = 3 and (select min(s) from unnest(v_sizes) s) < 3,
    'two people exporting the same view get different rows');

  -- 3. Importing writes a page and its body as the importer.
  perform tests.authenticate(v_staff);
  perform tests.ok(tests.x1_page_insert_allowed(v_org, 'workspace', v_staff), 'staff may import into the workspace');
  perform tests.ok(tests.x1_page_insert_allowed(v_org, 'private', v_staff), 'staff may import a private page');
  reset role;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(not tests.x1_page_insert_allowed(v_org, 'workspace', v_volunteer), 'a volunteer cannot import into the workspace');
  perform tests.ok(tests.x1_page_insert_allowed(v_org, 'private', v_volunteer), 'a volunteer may import a private page');
  perform tests.ok(not tests.x1_page_insert_allowed(v_org, 'private', v_staff), 'nobody can import a page as someone else');
  perform tests.ok(not tests.x1_body_insert_allowed(v_org, v_private, v_volunteer),
    'nobody can write the body of a page that is not theirs');
  reset role;

  foreach v_person in array array[v_guest, v_readonly] loop
    perform tests.authenticate(v_person);
    perform tests.ok(not tests.x1_page_insert_allowed(v_org, 'workspace', v_person),
      format('%s cannot import into the workspace', v_person));
    reset role;
  end loop;

  perform tests.clear_auth();
  perform tests.ok(not tests.x1_page_insert_allowed(v_org, 'private', v_staff), 'a signed-out request cannot import');
  reset role;

  -- 4. The export's audit record.
  perform tests.authenticate(v_volunteer);
  perform tests.ok(tests.x1_audit_insert_allowed(v_org, v_volunteer), 'an exporter records their own export');
  perform tests.ok(not tests.x1_audit_insert_allowed(gen_random_uuid(), v_volunteer), 'nobody records an export in another organization');
  perform tests.ok(not exists (select 1 from public.audit_event where action = 'page_exported'),
    'a non-admin cannot read export records back');
  reset role;
end;
$$;

rollback;
