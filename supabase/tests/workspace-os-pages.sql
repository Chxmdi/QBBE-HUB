-- Workspace OS pages (M4a): who can read, create, change, favourite and visit
-- pages, for every role. Run after qa-users.sql and rls.sql. Rolled back.
--
-- Fixture people: owner a1, staff a2, volunteer a3, admin a4, guest a5; a9 is
-- made a leadership viewer inside this transaction (the fixtures have none).
begin;

-- Signed out has no table privilege at all, which also counts as not visible.
create or replace function tests.page_visible(p_page uuid)
returns boolean
language plpgsql
as $$
begin
  return exists (select 1 from public.page where id = p_page);
exception when insufficient_privilege then
  return false;
end;
$$;

-- Tries an insert as the current role and reports whether it was allowed.
create or replace function tests.page_insert_allowed(
  p_org uuid, p_visibility text, p_created_by uuid, p_parent uuid default null
)
returns boolean
language plpgsql
as $$
begin
  insert into public.page (organization_id, visibility, created_by, parent_page_id, title)
  values (p_org, p_visibility, p_created_by, p_parent, 'Probe');
  return true;
exception when insufficient_privilege or check_violation then
  return false;
end;
$$;

-- Tries a title change and reports whether a row changed.
create or replace function tests.page_update_allowed(p_page uuid)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.page set title = title || '.' where id = p_page;
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
  p_shared uuid;
  p_child uuid;
  p_grandchild uuid;
  p_staff_private uuid;
  p_volunteer_private uuid;
  v_person uuid;
  v_ok boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer'
  where user_id = v_viewer and organization_id = v_org;

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Shared handbook') returning id into p_shared;
  insert into public.page (organization_id, parent_page_id, created_by, title)
  values (v_org, p_shared, v_staff, 'Child') returning id into p_child;
  insert into public.page (organization_id, parent_page_id, created_by, title)
  values (v_org, p_child, v_staff, 'Grandchild') returning id into p_grandchild;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_staff, 'Staff notes') returning id into p_staff_private;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_volunteer, 'Volunteer notes') returning id into p_volunteer_private;

  -- Hardening --------------------------------------------------------------
  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.page'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.page_favourite'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.page_visit'::regclass),
    'pages: RLS is on for page, page_favourite and page_visit'
  );
  perform tests.ok(
    not has_function_privilege('anon', 'public.can_page(uuid, text)', 'execute')
      and has_function_privilege('authenticated', 'public.can_page(uuid, text)', 'execute'),
    'pages: can_page is callable when signed in, not signed out'
  );
  perform tests.ok(
    not has_table_privilege('authenticated', 'public.page', 'delete'),
    'pages: signed-in people cannot hard-delete a page (trash only)'
  );
  perform tests.ok(
    (select bool_and(p.proconfig @> array['search_path=""'])
     from pg_proc p
     where p.pronamespace = 'app'::regnamespace
       and p.proname in ('can_page', 'can_read_page_row', 'can_write_page_row',
                         'page_before_write', 'page_cascade_visibility')),
    'pages: every definer function pins an empty search_path'
  );
  perform tests.ok(
    (select visibility from public.page where id = p_grandchild) = 'workspace',
    'pages: a child takes its parent''s visibility'
  );

  -- Reading a workspace page ---------------------------------------------------
  foreach v_person in array array[v_owner, v_admin, v_staff, v_viewer] loop
    perform tests.authenticate(v_person, 'aal1');
    v_ok := tests.page_visible(p_shared) and tests.page_visible(p_grandchild);
    reset role;
    perform tests.ok(v_ok, 'pages: ' || v_person || ' reads workspace pages (even at AAL1)');
  end loop;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person);
    v_ok := tests.page_visible(p_shared);
    reset role;
    perform tests.ok(not v_ok, 'pages: ' || v_person || ' does not read workspace pages');
  end loop;

  perform tests.clear_auth();
  v_ok := tests.page_visible(p_shared);
  reset role;
  perform tests.ok(not v_ok, 'pages: signed-out cannot read pages');

  -- Reading a private page ------------------------------------------------------
  perform tests.authenticate(v_staff);
  v_ok := tests.page_visible(p_staff_private) and not tests.page_visible(p_volunteer_private);
  reset role;
  perform tests.ok(v_ok, 'pages: staff reads their private page and not the volunteer''s');

  foreach v_person in array array[v_owner, v_admin, v_viewer, v_volunteer, v_guest] loop
    perform tests.authenticate(v_person);
    v_ok := tests.page_visible(p_staff_private);
    reset role;
    perform tests.ok(not v_ok, 'pages: ' || v_person || ' cannot read someone else''s private page');
  end loop;

  perform tests.authenticate(v_volunteer);
  v_ok := tests.page_visible(p_volunteer_private);
  reset role;
  perform tests.ok(v_ok, 'pages: the volunteer reads their own private page');

  -- Creating workspace pages ------------------------------------------------------
  foreach v_person in array array[v_staff, v_owner, v_admin] loop
    perform tests.authenticate(v_person, 'aal2');
    v_ok := tests.page_insert_allowed(v_org, 'workspace', v_person);
    reset role;
    perform tests.ok(v_ok, 'pages: ' || v_person || ' creates a workspace page');
  end loop;

  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person, 'aal1');
    v_ok := tests.page_insert_allowed(v_org, 'workspace', v_person);
    reset role;
    perform tests.ok(not v_ok, 'pages: ' || v_person || ' needs two-step sign-in to create a workspace page');
  end loop;

  foreach v_person in array array[v_volunteer, v_guest, v_viewer] loop
    perform tests.authenticate(v_person);
    v_ok := tests.page_insert_allowed(v_org, 'workspace', v_person);
    reset role;
    perform tests.ok(not v_ok, 'pages: ' || v_person || ' cannot create a workspace page');
  end loop;

  perform tests.clear_auth();
  v_ok := tests.page_insert_allowed(v_org, 'workspace', v_owner);
  reset role;
  perform tests.ok(not v_ok, 'pages: signed-out cannot create a page');

  -- Creating private pages ------------------------------------------------------
  foreach v_person in array array[v_volunteer, v_staff] loop
    perform tests.authenticate(v_person);
    v_ok := tests.page_insert_allowed(v_org, 'private', v_person);
    reset role;
    perform tests.ok(v_ok, 'pages: ' || v_person || ' creates a private page');
  end loop;

  foreach v_person in array array[v_guest, v_viewer] loop
    perform tests.authenticate(v_person);
    v_ok := tests.page_insert_allowed(v_org, 'private', v_person);
    reset role;
    perform tests.ok(not v_ok, 'pages: ' || v_person || ' cannot create pages at all');
  end loop;

  perform tests.authenticate(v_volunteer);
  v_ok := tests.page_insert_allowed(v_org, 'private', v_staff);
  reset role;
  perform tests.ok(not v_ok, 'pages: nobody creates a page in someone else''s name');

  perform tests.authenticate(v_volunteer);
  v_ok := tests.page_insert_allowed(v_org, 'private', v_volunteer, p_staff_private);
  reset role;
  perform tests.ok(not v_ok, 'pages: nobody nests a page inside someone else''s private page');

  -- Changing pages ----------------------------------------------------------------
  perform tests.authenticate(v_staff);
  v_ok := tests.page_update_allowed(p_shared);
  reset role;
  perform tests.ok(v_ok, 'pages: staff edits a workspace page');

  perform tests.authenticate(v_owner, 'aal2');
  v_ok := tests.page_update_allowed(p_shared);
  reset role;
  perform tests.ok(v_ok, 'pages: owner with two-step sign-in edits a workspace page');

  foreach v_person in array array[v_volunteer, v_guest, v_viewer] loop
    perform tests.authenticate(v_person);
    v_ok := tests.page_update_allowed(p_shared);
    reset role;
    perform tests.ok(not v_ok, 'pages: ' || v_person || ' cannot edit a workspace page');
  end loop;

  perform tests.authenticate(v_admin, 'aal1');
  v_ok := tests.page_update_allowed(p_shared);
  reset role;
  perform tests.ok(not v_ok, 'pages: admin at AAL1 cannot edit a workspace page');

  perform tests.authenticate(v_volunteer);
  v_ok := tests.page_update_allowed(p_volunteer_private);
  reset role;
  perform tests.ok(v_ok, 'pages: the volunteer edits their own private page');

  foreach v_person in array array[v_staff, v_owner] loop
    perform tests.authenticate(v_person);
    v_ok := tests.page_update_allowed(p_volunteer_private);
    reset role;
    perform tests.ok(not v_ok, 'pages: ' || v_person || ' cannot edit someone else''s private page');
  end loop;

  -- Moving -------------------------------------------------------------------------
  perform tests.authenticate(v_staff);
  begin
    update public.page set parent_page_id = p_grandchild where id = p_shared;
    v_ok := true;
  exception when check_violation then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'pages: a page cannot be moved inside its own subtree');

  -- The owner cannot take the shared tree private: it holds staff's pages.
  perform tests.authenticate(v_owner);
  begin
    update public.page set visibility = 'private' where id = p_shared;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'pages: a tree holding other people''s pages cannot become private');

  -- Staff takes their own subtree private: children follow.
  perform tests.authenticate(v_staff);
  update public.page set parent_page_id = null, visibility = 'private' where id = p_child;
  reset role;
  perform tests.ok(
    (select visibility from public.page where id = p_grandchild) = 'private',
    'pages: moving a tree to private moves its children with it'
  );
  perform tests.authenticate(v_owner);
  v_ok := tests.page_visible(p_grandchild);
  reset role;
  perform tests.ok(not v_ok, 'pages: once private, the owner no longer sees staff''s moved pages');

  perform tests.authenticate(v_staff);
  update public.page set parent_page_id = p_shared where id = p_child;
  reset role;
  perform tests.ok(
    (select visibility from public.page where id = p_grandchild) = 'workspace',
    'pages: moving back under a workspace page shares the whole tree again'
  );

  perform tests.authenticate(v_staff);
  begin
    update public.page set created_by = v_volunteer where id = p_child;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'pages: a page''s creator cannot be changed');

  perform tests.authenticate(v_staff);
  begin
    delete from public.page where id = p_child;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'pages: staff cannot hard-delete a page');

  -- Trashing (soft delete) stays an update; a trashed page refuses edits via can_page.
  perform tests.authenticate(v_staff);
  update public.page set deleted_at = now() where id = p_child;
  v_ok := public.can_page(p_child, 'view') and not public.can_page(p_child, 'edit_content');
  reset role;
  perform tests.ok(v_ok, 'pages: a trashed page can still be viewed (to restore) but not edited');

  -- can_page ------------------------------------------------------------------------
  perform tests.authenticate(v_staff);
  v_ok := public.can_page(p_shared, 'view') and public.can_page(p_shared, 'edit_content')
    and not public.can_page(p_volunteer_private, 'view')
    and not public.can_page(p_shared, 'nonsense')
    and not public.can_page(gen_random_uuid(), 'view');
  reset role;
  perform tests.ok(v_ok, 'pages: can_page answers for staff');

  perform tests.authenticate(v_volunteer);
  v_ok := not public.can_page(p_shared, 'view') and public.can_page(p_volunteer_private, 'manage');
  reset role;
  perform tests.ok(v_ok, 'pages: can_page answers for the volunteer');

  perform tests.authenticate(v_viewer);
  v_ok := public.can_page(p_shared, 'view') and not public.can_page(p_shared, 'comment');
  reset role;
  perform tests.ok(v_ok, 'pages: the leadership viewer reads but cannot change');

  -- Favourites and recent visits ------------------------------------------------------
  perform tests.authenticate(v_staff);
  insert into public.page_favourite (page_id) values (p_shared);
  insert into public.page_visit (page_id) values (p_shared);
  reset role;
  perform tests.ok(true, 'pages: staff favourites and visits a workspace page');

  perform tests.authenticate(v_volunteer);
  begin
    insert into public.page_favourite (page_id) values (p_shared);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'pages: the volunteer cannot favourite a page they cannot read');

  perform tests.authenticate(v_volunteer);
  begin
    insert into public.page_visit (user_id, page_id) values (v_staff, p_volunteer_private);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'pages: nobody writes into someone else''s recent list');

  foreach v_person in array array[v_owner, v_admin, v_volunteer] loop
    perform tests.authenticate(v_person);
    v_ok := not exists (select 1 from public.page_favourite where user_id = v_staff)
      and not exists (select 1 from public.page_visit where user_id = v_staff);
    reset role;
    perform tests.ok(v_ok, 'pages: ' || v_person || ' does not see staff''s favourites or recent pages');
  end loop;

  perform tests.clear_auth();
  begin
    v_ok := exists (select 1 from public.page_favourite);
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(not v_ok, 'pages: signed-out sees no favourites');

  -- A deactivated member loses pages and their lists at once.
  update public.organization_membership set status = 'deactivated'
  where user_id = v_staff and organization_id = v_org;
  perform tests.authenticate(v_staff);
  v_ok := not tests.page_visible(p_shared)
    and not tests.page_visible(p_staff_private)
    and not exists (select 1 from public.page_favourite);
  reset role;
  perform tests.ok(v_ok, 'pages: a deactivated member loses pages and favourites at once');
end;
$$;

rollback;
