-- Workspace OS share menu (M10f): the parent chain is given only to someone
-- who can view the node. Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_task uuid;
  v_custom uuid;
  v_staff_private uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Share menu', 'sm-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Share menu project', v_staff, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Share menu task', v_owner, v_volunteer) returning id into v_task;
  insert into public.space (organization_id, kind, name_en, name_fr) values (v_org, 'custom', 'Board', 'Conseil')
  returning id into v_custom;
  select id into strict v_staff_private from public.space where owner_id = v_staff and kind = 'private' and organization_id = v_org;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(public.access_ancestors(v_task) = array[v_task, v_project, v_program],
    'someone who can view a task gets its chain, nearest first');
  perform tests.ok(public.access_ancestors(v_project) is null and public.access_ancestors(v_custom) is null,
    'someone who cannot view a node gets nothing, not even its chain');
  reset role;

  perform tests.authenticate(v_admin);
  perform tests.ok(public.access_ancestors(v_custom) = array[v_custom], 'an admin gets a custom space''s chain');
  perform tests.ok(public.access_ancestors(v_staff_private) is null, 'but not someone else''s private space');
  reset role;

  perform tests.authenticate(v_staff);
  perform tests.ok(public.access_ancestors(v_staff_private) = array[v_staff_private], 'the owner gets their private space''s chain');
  reset role;

  perform tests.authenticate(v_guest);
  perform tests.ok(public.access_ancestors(v_task) is null and public.access_ancestors(gen_random_uuid()) is null,
    'a guest with no relationship, and an unknown id, get nothing');
  reset role;
end;
$$;

do $$
declare
  v_error text;
begin
  perform tests.clear_auth();
  begin
    perform public.access_ancestors(gen_random_uuid());
  exception when insufficient_privilege then
    v_error := sqlerrm;
  end;
  reset role;
  perform tests.ok(v_error is not null, 'a signed-out visitor cannot call access_ancestors');
end;
$$;

rollback;
