-- Workspace OS apps (V2-3): who can see, use, change and publish an app.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
--
-- Owner and admin (with two-step sign-in) manage every app, drafts included.
-- Everyone else sees a published app only through a grant to their role or to
-- them, and only for the capabilities it names. The external accountant (a
-- Guest with a ledger grant) and signed-out visitors get nothing by default.
begin;

create or replace function tests.app_raises(p_sql text, p_msg text)
returns void
language plpgsql
as $$
declare
  v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_raised := true;
  end;
  perform tests.ok(v_raised, p_msg);
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_app uuid;
  n integer;
  v_ok boolean;
begin
  select organization_id into v_org from public.organization_membership where user_id = v_owner;

  perform tests.authenticate(v_owner);
  insert into public.workspace_app (organization_id, slug, name_en, name_fr, definition)
  values (v_org, 'hiring', 'Hiring', 'Embauche', '{"version":1}')
  returning id into v_app;
  perform tests.ok(v_app is not null, 'owner can create an app');
  reset role;

  perform tests.authenticate(v_admin);
  update public.workspace_app set name_en = 'Hiring desk' where id = v_app;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'admin can change an app');
  perform tests.ok(public.can_use_app(v_app, 'view'), 'admin can open a draft app');
  perform tests.app_raises(format('update public.workspace_app set published_at = now() where id = %L', v_app),
    'nobody publishes by writing the column directly');
  insert into public.workspace_app_grant (organization_id, app_id, org_role, capabilities)
  values (v_org, v_app, 'staff', array['view', 'run_workflow']);
  insert into public.workspace_app_grant (organization_id, app_id, user_id, capabilities)
  values (v_org, v_app, v_volunteer, array['view']);
  perform tests.ok(true, 'admin can grant a role and a person');
  perform tests.app_raises(format('insert into public.workspace_app_grant (organization_id, app_id, org_role, capabilities) values (%L, %L, ''guest'', array[''delete''])', v_org, v_app),
    'a grant only holds known capabilities');
  reset role;

  -- A draft is invisible to everyone but owners and admins, grants or not.
  perform tests.authenticate(v_staff);
  select count(*) into n from public.workspace_app where id = v_app;
  perform tests.ok(n = 0, 'staff cannot see a draft app even with a grant');
  perform tests.ok(not public.can_use_app(v_app, 'view'), 'staff cannot use a draft app');
  perform tests.app_raises(format('select public.workspace_app_set_published(%L, true)', v_app), 'staff cannot publish');
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(not public.can_use_app(v_app, 'view'), 'owner without two-step sign-in cannot open a draft');
  perform tests.app_raises(format('select public.workspace_app_set_published(%L, true)', v_app), 'owner without two-step sign-in cannot publish');
  reset role;

  perform tests.authenticate(v_owner);
  perform public.workspace_app_set_published(v_app, true);
  select published_at is not null into v_ok from public.workspace_app where id = v_app;
  perform tests.ok(v_ok, 'owner can publish');
  reset role;

  -- Staff: granted view and run_workflow through their role.
  perform tests.authenticate(v_staff);
  select count(*) into n from public.workspace_app where id = v_app;
  perform tests.ok(n = 1, 'staff see a published app granted to their role');
  perform tests.ok(public.can_use_app(v_app, 'run_workflow'), 'staff can run the app''s actions');
  perform tests.ok(not public.can_use_app(v_app, 'manage'), 'staff cannot manage the app');
  update public.workspace_app set name_en = 'Changed' where id = v_app;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'staff cannot change the app');
  select count(*) into n from public.workspace_app_grant where app_id = v_app;
  perform tests.ok(n = 0, 'staff cannot read the grant list');
  perform tests.app_raises(format('insert into public.workspace_app_grant (organization_id, app_id, user_id, capabilities) values (%L, %L, %L, array[''manage''])', v_org, v_app, v_staff),
    'staff cannot grant themselves more');
  reset role;

  -- Volunteer: granted view as a person.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.workspace_app where id = v_app;
  perform tests.ok(n = 1, 'a volunteer sees a published app granted to them');
  perform tests.ok(not public.can_use_app(v_app, 'run_workflow'), 'a view grant does not run actions');
  select count(*) into n from public.workspace_app_grant where app_id = v_app;
  perform tests.ok(n = 1, 'a volunteer reads only their own grant');
  delete from public.workspace_app where id = v_app;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot delete the app');
  reset role;

  -- Member (Guest): no grant.
  perform tests.authenticate(v_guest);
  select count(*) into n from public.workspace_app where id = v_app;
  perform tests.ok(n = 0, 'a member without a grant sees nothing');
  perform tests.app_raises(format('insert into public.workspace_app (organization_id, slug, name_en, name_fr, definition) values (%L, ''mine'', ''M'', ''M'', ''{}'')', v_org),
    'a member cannot create an app');
  reset role;

  -- The external accountant: a Guest with a live ledger grant, still no app grant.
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);
  perform tests.authenticate(v_guest);
  select count(*) into n from public.workspace_app where id = v_app;
  perform tests.ok(n = 0, 'the accountant sees no app without a grant');
  perform tests.ok(not public.can_use_app(v_app, 'view'), 'the accountant cannot use the app');
  reset role;

  -- A manage grant lets a staff member change the app, but not publish or delete it.
  perform tests.authenticate(v_admin);
  update public.workspace_app_grant set capabilities = array['manage'] where app_id = v_app and org_role = 'staff';
  reset role;
  perform tests.authenticate(v_staff);
  update public.workspace_app set name_en = 'Hiring (staff edit)' where id = v_app;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a manage grant lets staff change the app');
  perform tests.app_raises(format('select public.workspace_app_set_published(%L, false)', v_app), 'a manage grant does not publish');
  delete from public.workspace_app where id = v_app;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a manage grant does not delete');
  reset role;

  -- Deactivated members lose access at once.
  update public.organization_membership set status = 'deactivated' where user_id = v_volunteer and organization_id = v_org;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(not public.can_use_app(v_app, 'view'), 'a deactivated member loses the app immediately');
  reset role;

  -- Archived apps close to everyone but admins.
  update public.workspace_app set archived_at = now() where id = v_app;
  perform tests.authenticate(v_staff);
  perform tests.ok(not public.can_use_app(v_app, 'view'), 'an archived app is closed to granted staff');
  reset role;

  perform tests.clear_auth();
  perform tests.app_raises('select count(*) from public.workspace_app', 'a signed-out visitor cannot read apps');
  perform tests.app_raises(format('select public.can_use_app(%L, ''view'')', v_app), 'a signed-out visitor cannot ask about apps');
  reset role;

  perform tests.authenticate(v_owner);
  delete from public.workspace_app where id = v_app;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'owner can delete an app');
  select count(*) into n from public.workspace_app_grant where app_id = v_app;
  perform tests.ok(n = 0, 'deleting an app deletes its grants');
  reset role;
end;
$$;

rollback;
