-- Workspace OS editor documents (M4b): the body of a page or task follows
-- that object's access, for every role. Run after qa-users.sql and rls.sql.
-- Rolled back.
begin;

create or replace function tests.editor_doc_visible(p_object uuid)
returns boolean
language plpgsql
as $$
begin
  return exists (select 1 from public.editor_document where object_id = p_object);
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function tests.editor_doc_write_allowed(p_type text, p_object uuid, p_as uuid)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.editor_document
  set content = '{"version":1,"blocks":[{"type":"paragraph"}]}'::jsonb, content_text = 'probe'
  where object_id = p_object;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return true;
  end if;
  insert into public.editor_document (object_id, object_type, organization_id, created_by)
  select p_object, p_type, m.organization_id, p_as
  from public.organization_membership m where m.user_id = p_as limit 1;
  return true;
exception when insufficient_privilege or unique_violation then
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
  v_program uuid;
  v_project uuid;
  p_shared uuid;
  p_private uuid;
  t_assigned uuid;
  t_unrelated uuid;
  v_person uuid;
  v_ok boolean;
  v_version integer;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer'
  where user_id = v_viewer and organization_id = v_org;
  insert into public.organization (name, slug) values ('Other org', 'other-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Shared') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_volunteer, 'Mine') returning id into p_private;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Editor docs', 'editor-docs-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Editor docs', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Assigned', v_owner, v_volunteer) returning id into t_assigned;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Unrelated', v_owner) returning id into t_unrelated;

  -- Organization is taken from the object, whatever the caller sends.
  insert into public.editor_document (object_id, object_type, organization_id, created_by)
  values (p_shared, 'page', v_other_org, v_owner);
  insert into public.editor_document (object_id, object_type, organization_id, created_by)
  values (p_private, 'page', v_org, v_volunteer);
  insert into public.editor_document (object_id, object_type, organization_id, created_by)
  values (t_assigned, 'task', v_org, v_owner);
  insert into public.editor_document (object_id, object_type, organization_id, created_by)
  values (t_unrelated, 'task', v_org, v_owner);

  perform tests.ok(
    (select organization_id from public.editor_document where object_id = p_shared) = v_org,
    'editor docs: a document takes its object''s organization'
  );
  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.editor_document'::regclass)
      and not has_table_privilege('authenticated', 'public.editor_document', 'delete')
      and not has_table_privilege('anon', 'public.editor_document', 'select'),
    'editor docs: RLS on; no delete; nothing for signed-out'
  );
  perform tests.ok(
    (select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
     where p.pronamespace = 'app'::regnamespace
       and p.proname in ('can_editor_object', 'editor_document_before_write')),
    'editor docs: definer functions pin an empty search_path'
  );

  -- Page bodies follow the page -------------------------------------------------
  foreach v_person in array array[v_owner, v_admin, v_staff, v_viewer] loop
    perform tests.authenticate(v_person, 'aal1');
    v_ok := tests.editor_doc_visible(p_shared);
    reset role;
    perform tests.ok(v_ok, 'editor docs: ' || v_person || ' reads a workspace page body');
  end loop;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person);
    v_ok := tests.editor_doc_visible(p_shared);
    reset role;
    perform tests.ok(not v_ok, 'editor docs: ' || v_person || ' cannot read a workspace page body');
  end loop;

  foreach v_person in array array[v_staff, v_owner, v_admin] loop
    perform tests.authenticate(v_person, 'aal2');
    v_ok := tests.editor_doc_write_allowed('page', p_shared, v_person);
    reset role;
    perform tests.ok(v_ok, 'editor docs: ' || v_person || ' edits a workspace page body');
  end loop;

  foreach v_person in array array[v_volunteer, v_guest, v_viewer] loop
    perform tests.authenticate(v_person);
    v_ok := tests.editor_doc_write_allowed('page', p_shared, v_person);
    reset role;
    perform tests.ok(not v_ok, 'editor docs: ' || v_person || ' cannot edit a workspace page body');
  end loop;

  perform tests.authenticate(v_admin, 'aal1');
  v_ok := tests.editor_doc_write_allowed('page', p_shared, v_admin);
  reset role;
  perform tests.ok(not v_ok, 'editor docs: admin needs two-step sign-in to edit a page body');

  perform tests.authenticate(v_volunteer);
  v_ok := tests.editor_doc_visible(p_private) and tests.editor_doc_write_allowed('page', p_private, v_volunteer);
  reset role;
  perform tests.ok(v_ok, 'editor docs: the volunteer reads and edits their private page body');

  foreach v_person in array array[v_owner, v_admin, v_staff] loop
    perform tests.authenticate(v_person);
    v_ok := tests.editor_doc_visible(p_private) or tests.editor_doc_write_allowed('page', p_private, v_person);
    reset role;
    perform tests.ok(not v_ok, 'editor docs: ' || v_person || ' cannot read or edit someone else''s private page body');
  end loop;

  -- Task bodies follow the task --------------------------------------------------
  perform tests.authenticate(v_volunteer);
  v_ok := tests.editor_doc_visible(t_assigned) and not tests.editor_doc_visible(t_unrelated);
  reset role;
  perform tests.ok(v_ok, 'editor docs: the volunteer reads their assigned task''s body, not an unrelated one');

  perform tests.authenticate(v_guest);
  v_ok := tests.editor_doc_visible(t_assigned);
  reset role;
  perform tests.ok(not v_ok, 'editor docs: a guest cannot read a task body they have no part in');

  perform tests.authenticate(v_owner, 'aal2');
  v_ok := tests.editor_doc_write_allowed('task', t_unrelated, v_owner);
  reset role;
  perform tests.ok(v_ok, 'editor docs: the owner edits a task body');

  perform tests.authenticate(v_volunteer);
  v_ok := tests.editor_doc_write_allowed('task', t_unrelated, v_volunteer);
  reset role;
  perform tests.ok(not v_ok, 'editor docs: the volunteer cannot edit an unrelated task''s body');

  -- Signed out ---------------------------------------------------------------------
  perform tests.clear_auth();
  v_ok := tests.editor_doc_visible(p_shared) or tests.editor_doc_write_allowed('page', p_shared, v_owner);
  reset role;
  perform tests.ok(not v_ok, 'editor docs: signed-out cannot read or write');

  -- Integrity ------------------------------------------------------------------------
  select version into v_version from public.editor_document where object_id = p_shared;
  perform tests.authenticate(v_staff);
  update public.editor_document set version = 1 where object_id = p_shared;
  reset role;
  perform tests.ok(
    (select version from public.editor_document where object_id = p_shared) = v_version + 1,
    'editor docs: every save raises the version, whatever the caller sends'
  );

  perform tests.authenticate(v_staff);
  begin
    update public.editor_document set object_id = t_unrelated where object_id = p_shared;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'editor docs: a document cannot be moved to another object');

  perform tests.authenticate(v_staff);
  begin
    delete from public.editor_document where object_id = p_shared;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'editor docs: a document cannot be deleted through the API');

  begin
    insert into public.editor_document (object_id, object_type, organization_id, created_by)
    values (gen_random_uuid(), 'page', v_org, v_owner);
    v_ok := true;
  exception when foreign_key_violation then
    v_ok := false;
  end;
  perform tests.ok(not v_ok, 'editor docs: a document needs an existing object');
end;
$$;

rollback;
