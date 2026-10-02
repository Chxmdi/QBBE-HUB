-- Files added in the editor (migration 20261111010000): a file follows the
-- page it was added to. Whoever may edit the page may add one; whoever may
-- read the page may read it, and nobody else. Run after qa-users.sql and
-- rls.sql. Rolled back.
begin;

-- The upload itself must already be in Storage, owned by the caller: the scan
-- trigger refuses to register anyone else's object.
create or replace function tests.editor_file_upload(p_as uuid)
returns text
language plpgsql
as $$
declare
  v_path text := 'editor-files/' || gen_random_uuid() || '.png';
begin
  insert into storage.objects (bucket_id, name, owner_id) values ('documents', v_path, p_as::text);
  return v_path;
end;
$$;

create or replace function tests.editor_file_insert(p_org uuid, p_page uuid, p_as uuid, p_path text, p_visibility text default 'staff')
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.document (organization_id, title, kind, storage_path, visibility,
                               editor_object_type, editor_object_id, owner_id, created_by)
  values (p_org, 'pasted.png', 'file', p_path, p_visibility,
          case when p_page is null then null else 'page' end, p_page, p_as, p_as)
  returning id into v_id;
  return v_id;
exception when insufficient_privilege then
  return null;
end;
$$;

create or replace function tests.editor_file_visible(p_document uuid)
returns boolean
language sql
as $$
  select exists (select 1 from public.document where id = p_document);
$$;

grant execute on all functions in schema tests to anon, authenticated;
revoke execute on function tests.editor_file_upload(uuid) from anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_other_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  p_shared uuid;
  p_staff_private uuid;
  d_shared uuid;
  d_private uuid;
  d_loose uuid;
  v_ok boolean;
  v_path text;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_staff limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org
    and user_id in (v_owner, v_staff, v_volunteer, v_other_staff);

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Shared notes') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_staff, 'My drafts') returning id into p_staff_private;

  -- Adding a file -------------------------------------------------------------
  v_path := tests.editor_file_upload(v_staff);
  perform tests.authenticate(v_staff, 'aal1');
  d_shared := tests.editor_file_insert(v_org, p_shared, v_staff, v_path);
  reset role;
  perform tests.ok(d_shared is not null, 'editor files: staff add a file to a workspace page they can edit');

  v_path := tests.editor_file_upload(v_staff);
  perform tests.authenticate(v_staff, 'aal1');
  d_private := tests.editor_file_insert(v_org, p_staff_private, v_staff, v_path);
  reset role;
  perform tests.ok(d_private is not null, 'editor files: staff add a file to their own private page');

  v_path := tests.editor_file_upload(v_volunteer);
  perform tests.authenticate(v_volunteer, 'aal1');
  v_ok := tests.editor_file_insert(v_org, p_shared, v_volunteer, v_path) is null;
  reset role;
  perform tests.ok(v_ok, 'editor files: a volunteer who cannot edit the page cannot add a file to it');

  v_path := tests.editor_file_upload(v_staff);
  perform tests.authenticate(v_staff, 'aal1');
  d_loose := tests.editor_file_insert(v_org, null, v_staff, v_path);
  reset role;
  perform tests.ok(d_loose is null, 'editor files: a staff-only file on no page is still refused to staff');

  -- Reading a file ------------------------------------------------------------
  perform tests.authenticate(v_other_staff, 'aal1');
  v_ok := tests.editor_file_visible(d_shared) and app.can_read_document(d_shared);
  reset role;
  perform tests.ok(v_ok, 'editor files: another staff member who can read the page reads its file');

  perform tests.authenticate(v_volunteer, 'aal1');
  v_ok := tests.editor_file_visible(d_shared) or app.can_read_document(d_shared);
  reset role;
  perform tests.ok(not v_ok, 'editor files: a volunteer who cannot read the page cannot read its file');

  perform tests.authenticate(v_other_staff, 'aal1');
  v_ok := tests.editor_file_visible(d_private) or app.can_read_document(d_private);
  reset role;
  perform tests.ok(not v_ok, 'editor files: a file on someone else''s private page stays private');

  perform tests.authenticate(v_staff, 'aal1');
  v_ok := tests.editor_file_visible(d_private);
  reset role;
  perform tests.ok(v_ok, 'editor files: the page''s author reads the file on their private page');

  -- A file stays with its page --------------------------------------------------
  begin
    update public.document set editor_object_id = p_shared where id = d_private;
    raise exception 'FAIL: a file moved to another page';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'editor files: a file cannot be moved to another page');

  begin
    insert into public.document (organization_id, title, kind, storage_path, editor_object_type, owner_id, created_by)
    values (v_org, 'half', 'file', 'editor-files/half.png', 'page', v_staff, v_staff);
    raise exception 'FAIL: a file named a page type without a page';
  exception when check_violation then null; end;
  perform tests.ok(true, 'editor files: a page type and a page id come together or not at all');
end;
$$;

rollback;
