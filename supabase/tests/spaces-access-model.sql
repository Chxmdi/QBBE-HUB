-- Workspace OS access model (M10b): today's tables are written through into
-- nodes and grants; the live answer equals today's rules; people can only
-- share what they may; Workspace OS objects inherit from parent and space.
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create function tests.am_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.am_raises(text, text, text) to authenticated, anon;

-- The model's bits for the signed-in person (the app schema is not open to
-- signed-in roles; this reads it with the test owner's rights, as the caller).
create function tests.am_has(p_object uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.access_bits(p_object) & app.cap_bit(p_capability) <> 0;
$$;
grant execute on function tests.am_has(uuid, text) to authenticated;

-- The object registry (S1) may not be on this branch yet: stand in for the
-- columns the access model reads, inside this transaction only.
do $$
begin
  if to_regclass('public.object') is null then
    create table public.object_type (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      key text not null,
      name_en text not null,
      name_fr text not null,
      kind text not null
    );
    create table public.object (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      type_id uuid not null,
      space_id uuid,
      parent_object_id uuid references public.object (id),
      title text not null default '',
      owner_id uuid,
      deleted_at timestamptz
    );
    perform app.access_attach_object_registry();
  end if;
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_pm uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_contributor uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_program uuid;
  v_program2 uuid;
  v_project uuid;
  v_loose_project uuid;
  t_project_task uuid;
  t_program_task uuid;
  t_loose_task uuid;
  t_assigned uuid;
  v_workspace uuid;
  v_custom uuid;
  v_staff_private uuid;
  v_team uuid;
  v_page_type uuid;
  v_page uuid;
  v_child_page uuid;
  v_private_page uuid;
  v_editor uuid := (select id from public.access_role where key = 'editor' and organization_id is null);
  v_viewer_role uuid := (select id from public.access_role where key = 'viewer' and organization_id is null);
  v_full uuid := (select id from public.access_role where key = 'full_access' and organization_id is null);
  v_manager uuid := (select id from public.access_role where key = 'manager' and organization_id is null);
  v_people uuid[];
  v_objects uuid[];
  v_person uuid;
  v_level text;
  v_object uuid;
  v_capability text;
  v_kind text;
  v_expected boolean;
  v_actual boolean;
  v_checked integer := 0;
  v_mismatches text[] := array[]::text[];
  v_rows integer;
  v_map constant jsonb := jsonb_build_object(
    'view', jsonb_build_array('read'),
    'comment', jsonb_build_array('manage', 'collaborate', 'review', 'approve'),
    'edit_content', jsonb_build_array('manage', 'collaborate'),
    'edit_structure', jsonb_build_array('manage'),
    'manage', jsonb_build_array('manage'),
    'share', jsonb_build_array('manage'),
    'run_workflow', jsonb_build_array('manage'),
    'read', jsonb_build_array('read'),
    'collaborate', jsonb_build_array('collaborate'),
    'review', jsonb_build_array('review'),
    'approve', jsonb_build_array('approve'),
    'follow', jsonb_build_array('follow')
  );
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_viewer;
  select id into strict v_workspace from public.space where organization_id = v_org and kind = 'workspace';
  select id into strict v_staff_private from public.space where organization_id = v_org and kind = 'private' and owner_id = v_staff;

  -- ------------------------------------------------------------------
  -- Fixture: two programs, a project in one, program-level and loose tasks,
  -- and every kind of today's grant.
  -- ------------------------------------------------------------------
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Access model A', 'am-a-' || substr(gen_random_uuid()::text, 1, 8), v_lead, v_owner)
  returning id into v_program;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Access model B', 'am-b-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program2;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Access model project', v_pm, v_owner) returning id into v_project;
  insert into public.project (organization_id, name, created_by)
  values (v_org, 'Loose project', v_owner) returning id into v_loose_project;

  insert into public.task (organization_id, project_id, program_id, title, created_by, requester_id)
  values (v_org, v_project, v_program, 'In the project', v_owner, v_staff) returning id into t_project_task;
  insert into public.task (organization_id, program_id, title, created_by, reviewer_id)
  values (v_org, v_program, 'Program-level', v_owner, v_guest) returning id into t_program_task;
  insert into public.task (organization_id, title, created_by, approver_id)
  values (v_org, 'Loose', v_owner, v_staff) returning id into t_loose_task;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_loose_project, 'Assigned', v_owner, v_volunteer) returning id into t_assigned;

  insert into public.program_access_grant (organization_id, program_id, user_id, role, source)
  values (v_org, v_program, v_contributor, 'contributor', 'direct'),
         (v_org, v_program2, v_staff, 'reviewer', 'direct');
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source)
  values (v_org, v_loose_project, v_guest, 'approver', 'direct');
  insert into public.task_assignment (task_id, user_id, role)
  values (t_loose_task, v_volunteer, 'follower'), (t_program_task, v_staff, 'reviewer');

  -- ------------------------------------------------------------------
  -- Dual write: the shape.
  -- ------------------------------------------------------------------
  perform tests.ok(
    (select ancestors from app.access_node where id = t_project_task) = array[t_project_task, v_project, v_program]
      and (select ancestors from app.access_node where id = t_program_task) = array[t_program_task, v_program]
      and (select ancestors from app.access_node where id = t_loose_task) = array[t_loose_task]
      and (select ancestors from app.access_node where id = t_assigned) = array[t_assigned, v_loose_project],
    'tasks sit under their project, else their program''s space, else nothing: not under the workspace');
  perform tests.ok(
    not exists (select 1 from public.task t where not exists (select 1 from app.access_node n where n.id = t.id))
      and not exists (select 1 from public.project p where not exists (select 1 from app.access_node n where n.id = p.id))
      and not exists (select 1 from public.program p where not exists (select 1 from app.access_node n where n.id = p.id))
      and not exists (select 1 from public.space s where not exists (select 1 from app.access_node n where n.id = s.id)),
    'every space, program, project and task is a node');
  perform tests.ok(
    (select count(*) from public.access_grant where source = 'program_access_grant')
      = (select count(*) from public.program_access_grant)
    and (select count(*) from public.access_grant where source = 'project_access_grant')
      = (select count(*) from public.project_access_grant where source <> 'program_inherited')
    and (select count(*) from public.access_grant where source = 'task_assignment')
      = (select count(*) from public.task_assignment),
    'every program and project grant and task role is mirrored; program-inherited copies are not');

  update public.task set requester_id = v_volunteer where id = t_project_task;
  perform tests.ok(
    (select array_agg(user_id) from public.access_grant where object_id = t_project_task and source = 'task.requester_id')
      = array[v_volunteer],
    'changing a task''s requester replaces the grant the column gives');
  delete from public.task_assignment where task_id = t_loose_task and user_id = v_volunteer;
  perform tests.ok(
    not exists (select 1 from public.access_grant where object_id = t_loose_task and user_id = v_volunteer and source = 'task_assignment'),
    'removing a task role removes its grant');

  update public.project set program_id = v_program2 where id = v_project;
  perform tests.ok(
    (select ancestors from app.access_node where id = t_project_task) = array[t_project_task, v_project, v_program2],
    'moving a project to another program moves its tasks'' chains too');
  update public.project set program_id = v_program where id = v_project;

  insert into public.task (organization_id, project_id, title, created_by)
  select v_org, v_project, 'Bulk ' || n, v_owner from generate_series(1, 200) n;
  perform tests.ok(
    (select count(*) from app.access_node n join public.task t on t.id = n.id
     where t.title like 'Bulk %' and n.ancestors = array[t.id, v_project, v_program]) = 200,
    'a bulk insert places every task in one pass');

  -- ------------------------------------------------------------------
  -- The live answer equals today's rules: every fixture person, both
  -- sign-in levels, every task, project and program, every capability name.
  -- ------------------------------------------------------------------
  select array_agg(user_id) into v_people from public.organization_membership where organization_id = v_org;
  select array_agg(id) into v_objects from (
    select id from public.task where title not like 'Bulk %'
    union all select id from public.project
    union all select id from public.program) o;

  foreach v_person in array v_people loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      foreach v_object in array v_objects loop
        v_kind := case
          when exists (select 1 from public.task where id = v_object) then 'task'
          when exists (select 1 from public.project where id = v_object) then 'project'
          else 'program' end;
        for v_capability in select jsonb_object_keys(v_map) loop
          select coalesce(bool_or(case v_kind
              when 'task' then public.has_task_capability(v_object, legacy)
              when 'project' then public.has_project_capability(v_object, legacy)
              else public.has_program_capability(v_object, legacy) end), false)
          into v_expected
          from jsonb_array_elements_text(v_map -> v_capability) legacy;
          v_actual := tests.am_has(v_object, v_capability);
          v_checked := v_checked + 1;
          if v_actual is distinct from v_expected then
            v_mismatches := v_mismatches || format('%s %s %s %s %s: model %s, today %s',
              v_person, v_level, v_kind, v_object, v_capability, v_actual, v_expected);
          end if;
        end loop;
      end loop;
      reset role;
    end loop;
  end loop;
  perform tests.ok(v_checked > 1000 and cardinality(v_mismatches) = 0,
    format('the access model agrees with today''s task, project and program rules on %s checks%s',
      v_checked, coalesce(': ' || nullif(array_to_string(v_mismatches[1:5], '; '), ''), '')));

  -- ------------------------------------------------------------------
  -- Sharing a custom space: who may, and with what.
  -- ------------------------------------------------------------------
  insert into public.space (organization_id, kind, name_en, name_fr)
  values (v_org, 'custom', 'Board', 'Conseil') returning id into v_custom;
  insert into public.team (organization_id, name, owner_id) values (v_org, 'Access model team', v_admin) returning id into v_team;
  insert into public.team_member (team_id, user_id) values (v_team, v_volunteer);

  perform tests.authenticate(v_staff);
  perform tests.ok(cardinality(public.space_capabilities(v_custom)) = 0, 'staff start with nothing in a custom space');
  perform tests.am_raises(format(
    'insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id) values (%L, %L, ''person'', %L, %L)',
    v_org, v_workspace, v_volunteer, v_viewer_role),
    'row-level security', 'staff cannot share the workspace: they do not hold share there');
  reset role;

  perform tests.authenticate(v_admin);
  insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id)
  values (v_org, v_custom, 'person', v_staff, v_full);
  insert into public.access_grant (organization_id, object_id, principal_kind, team_id, role_id)
  values (v_org, v_custom, 'team', v_team, v_viewer_role);
  insert into public.access_grant (organization_id, object_id, principal_kind, org_role, role_id)
  values (v_org, v_custom, 'org_role', 'guest', v_viewer_role);
  perform tests.ok(found, 'an admin shares a custom space with a person, a team and a role');
  perform tests.am_raises(format(
    'insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id) values (%L, %L, ''person'', %L, %L)',
    v_org, v_program, v_volunteer, v_viewer_role),
    'row-level security', 'program spaces are shared through their program''s access, not here');
  perform tests.am_raises(format(
    'insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id) values (%L, %L, ''person'', %L, %L)',
    v_org, t_loose_task, v_volunteer, v_viewer_role),
    'row-level security', 'tasks keep their own access rules');
  perform tests.am_raises(format(
    'insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id) values (%L, %L, ''person'', %L, %L)',
    v_org, v_staff_private, v_admin, v_viewer_role),
    'row-level security', 'a private space cannot be shared, even by an admin');
  perform tests.am_raises(format(
    'insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id) values (%L, %L, ''person'', %L, %L)',
    v_org, v_custom, v_volunteer, v_manager),
    'row-level security', 'the built-in manager role, which restates today''s rules, is not handed out here');
  reset role;

  -- What the shares give, and to whom.
  perform tests.authenticate(v_staff);
  perform tests.ok(public.space_capabilities(v_custom) = array['view', 'comment', 'edit_content', 'edit_structure', 'manage', 'run_workflow', 'share'],
    'the person grant gives staff full access to the custom space');
  -- Staff now hold share there: they may pass on what they hold, and no more.
  insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id)
  values (v_org, v_custom, 'person', v_contributor, v_editor);
  perform tests.ok(found, 'someone holding share passes on a role within what they hold');
  reset role;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(public.space_capabilities(v_custom) = array['view'], 'the team grant reaches a team member');
  select count(*) into v_rows from public.access_grant where object_id = v_custom;
  perform tests.ok(v_rows = 4, format('a person who can view the space sees who has access to it (%s)', v_rows));
  delete from public.access_grant where object_id = v_custom;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'viewing is not sharing: a viewer removes nobody''s access');
  reset role;

  perform tests.authenticate(v_guest);
  perform tests.ok(public.space_capabilities(v_custom) = array['view'], 'the role grant reaches everyone with the role');
  reset role;

  perform tests.authenticate(v_pm);
  perform tests.ok(cardinality(public.space_capabilities(v_custom)) = 0, 'nobody else gets anything');
  select count(*) into v_rows from public.access_grant where object_id = v_custom;
  perform tests.ok(v_rows = 0, 'nor sees who has access');
  reset role;

  perform tests.authenticate(v_contributor);
  perform tests.ok(public.space_capabilities(v_custom) = array['view', 'comment', 'edit_content'],
    'the editor role: view, comment and edit content');
  perform tests.am_raises(format(
    'insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id) values (%L, %L, ''person'', %L, %L)',
    v_org, v_custom, v_pm, v_viewer_role),
    'row-level security', 'an editor cannot share: editing is not sharing');
  reset role;

  -- Leaving the team, or the organization, takes access away at once.
  delete from public.team_member where team_id = v_team and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(cardinality(public.space_capabilities(v_custom)) = 0, 'leaving the team removes what the team was given');
  reset role;
  update public.organization_membership set status = 'deactivated' where organization_id = v_org and user_id = v_contributor;
  perform tests.authenticate(v_contributor);
  perform tests.ok(cardinality(public.space_capabilities(v_custom)) = 0, 'a deactivated member keeps nothing');
  reset role;
  update public.organization_membership set status = 'active' where organization_id = v_org and user_id = v_contributor;

  -- Mirrored rows are not the sharer's to remove: today's tables own them.
  perform tests.authenticate(v_owner);
  delete from public.access_grant where source <> 'direct';
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'nobody deletes mirrored grants through the API, the owner included');
  delete from public.access_grant where object_id = v_custom and principal_kind = 'org_role';
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 1, 'the owner removes a direct grant');
  reset role;

  -- ------------------------------------------------------------------
  -- Workspace OS objects: a page inherits from its parent and its space.
  -- ------------------------------------------------------------------
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_org, 'am_page', 'Page', 'Page', 'custom') returning id into v_page_type;
  insert into public.object (organization_id, type_id, space_id, title, owner_id)
  values (v_org, v_page_type, v_workspace, 'Handbook', v_admin) returning id into v_page;
  insert into public.object (organization_id, type_id, space_id, parent_object_id, title)
  values (v_org, v_page_type, v_workspace, v_page, 'Chapter') returning id into v_child_page;
  insert into public.object (organization_id, type_id, space_id, title, owner_id)
  values (v_org, v_page_type, v_staff_private, 'My notes', v_staff) returning id into v_private_page;

  perform tests.ok(
    (select ancestors from app.access_node where id = v_child_page) = array[v_child_page, v_page, v_workspace]
      and (select in_private from app.access_node where id = v_private_page),
    'pages sit under their parent page, then their space; a page in a private space is private');

  perform tests.authenticate(v_staff);
  perform tests.ok(public.object_capabilities(v_child_page) = array['view', 'comment', 'edit_content']
      and public.object_capabilities(v_private_page) @> array['share'],
    'staff edit workspace pages (from the space) and own their private page');
  reset role;
  perform tests.authenticate(v_admin);
  perform tests.ok(cardinality(public.object_capabilities(v_private_page)) = 0,
    'an admin cannot see a page in someone''s private space');
  perform tests.ok(public.object_capabilities(v_child_page) @> array['share'], 'an admin manages workspace pages');
  reset role;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(cardinality(public.object_capabilities(v_child_page)) = 0, 'volunteers get nothing in workspace pages by default');
  reset role;

  -- Sharing one private page, and a subtree.
  perform tests.authenticate(v_staff);
  insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id)
  values (v_org, v_private_page, 'person', v_volunteer, v_viewer_role);
  perform tests.ok(found, 'the owner of a private page shares it with one person');
  reset role;
  perform tests.authenticate(v_admin);
  insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id, reach)
  values (v_org, v_page, 'person', v_volunteer, v_editor, 'self');
  reset role;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(public.object_capabilities(v_private_page) = array['view'], 'the shared private page is visible to that person');
  perform tests.ok(public.object_capabilities(v_page) = array['view', 'comment', 'edit_content']
      and cardinality(public.object_capabilities(v_child_page)) = 0,
    'a grant for "this page only" does not reach the pages under it');
  reset role;
  perform tests.authenticate(v_admin);
  update public.access_grant set reach = 'subtree' where object_id = v_page and user_id = v_volunteer;
  reset role;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(public.object_capabilities(v_child_page) = array['view', 'comment', 'edit_content'],
    'widened to the pages under it, the grant reaches the child page');
  reset role;

  -- Moving a page moves everything under it.
  update public.object set space_id = v_custom, parent_object_id = null where id = v_page;
  perform tests.ok(
    (select ancestors from app.access_node where id = v_child_page) = array[v_child_page, v_page, v_custom],
    'moving a page to another space rewrites the chain of the pages under it');
  perform tests.authenticate(v_staff);
  perform tests.ok(public.object_capabilities(v_child_page) @> array['share'],
    'and access follows: staff now have what the custom space gives them');
  reset role;
end;
$$;

-- Signed out: nothing.
do $$
begin
  perform tests.clear_auth();
  perform tests.am_raises('select count(*) from public.access_grant', 'permission denied', 'a signed-out visitor cannot read grants');
  perform tests.am_raises('select count(*) from public.access_role', 'permission denied', 'a signed-out visitor cannot read roles');
  perform tests.am_raises(format('select public.object_capabilities(%L)', gen_random_uuid()), 'permission denied',
    'a signed-out visitor cannot ask about an object');
  reset role;
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and (p.proname like 'access\_%' or p.proname = 'space_capabilities')
       and p.proname not in ('access_program_role', 'access_project_role', 'access_finish_bits')),
    'access model functions are security definer with an empty search path');
  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.access_grant'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.access_role'::regclass)
      and (select relrowsecurity from pg_class where oid = 'app.access_node'::regclass)
      and not has_table_privilege('authenticated', 'app.access_node', 'select'),
    'row-level security is on; the node table is not reachable through the API');
end;
$$;

rollback;
