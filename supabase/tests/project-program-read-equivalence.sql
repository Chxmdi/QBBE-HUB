-- project_read, program_read, milestone_read and the two membership reads are
-- the rules they were, restated (#115, migration 20260925040000). For every
-- organization member at AAL1 and AAL2, and one stranger, the rows each table
-- shows must be exactly the rows the original functions admit:
--   project, project_membership, milestone: has_project_capability(project, 'read')
--   program, program_membership:            has_program_capability(program, 'read')
-- Expected rows are computed as the table owner with the reader's claims.
-- Run after qa-users.sql and rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_led_program uuid;
  v_granted_program uuid;
  v_closed_program uuid;
  v_granted_project uuid;
  v_closed_project uuid;
  v_user record;
  v_level text;
  v_table text;
  v_missing integer;
  v_extra integer;
  v_people integer := 0;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_guest);

  -- The same paths in, and ways not in, as task-read-equivalence.sql: a
  -- program the volunteer leads, one granted to the guest, one closed; a
  -- project the staff member owns, one granted to the guest, one inheriting
  -- the guest's program grant, one closed. Each project gets a milestone.
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Equivalence led', 'eq-led-' || substr(gen_random_uuid()::text, 1, 8), v_volunteer, v_owner)
  returning id into v_led_program;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Equivalence granted', 'eq-granted-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_granted_program;
  insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
  values (v_org, v_granted_program, v_guest, 'read_only', 'direct', v_owner);
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Equivalence closed', 'eq-closed-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_closed_program;

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Equivalence owned', v_staff, v_owner);
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Equivalence granted', v_owner, v_owner)
  returning id into v_granted_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_granted_project, v_guest, 'follower', 'direct', v_owner);
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_granted_program, 'Equivalence inherited', v_owner, v_owner);
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_closed_program, 'Equivalence closed', v_owner, v_owner)
  returning id into v_closed_project;
  insert into public.milestone (project_id, name)
  select id, 'eq: ' || name from public.project where name like 'Equivalence %';

  create temp table expected_row (tbl text, id text) on commit drop;
  create temp table actual_row (tbl text, id text) on commit drop;
  grant select, insert, delete on expected_row, actual_row to authenticated;

  for v_user in
    select distinct m.user_id, true as member from public.organization_membership m
    union all
    select gen_random_uuid(), false
  loop
    foreach v_level in array case when v_user.member then array['aal1', 'aal2'] else array['aal1'] end loop
      perform tests.authenticate(v_user.user_id, v_level);

      perform set_config('role', 'postgres', true);
      truncate expected_row, actual_row;
      insert into expected_row
      select 'project', id::text from public.project where app.has_project_capability(id, 'read')
      union all
      select 'program', id::text from public.program where app.has_program_capability(id, 'read')
      union all
      select 'milestone', id::text from public.milestone where app.has_project_capability(project_id, 'read')
      union all
      select 'project_membership', ctid::text from public.project_membership
      where app.has_project_capability(project_id, 'read')
      union all
      select 'program_membership', ctid::text from public.program_membership
      where app.has_program_capability(program_id, 'read');
      perform set_config('role', 'authenticated', true);

      insert into actual_row
      select 'project', id::text from public.project
      union all
      select 'program', id::text from public.program
      union all
      select 'milestone', id::text from public.milestone
      union all
      select 'project_membership', ctid::text from public.project_membership
      union all
      select 'program_membership', ctid::text from public.program_membership;

      foreach v_table in array array['project', 'program', 'milestone', 'project_membership', 'program_membership'] loop
        select count(*) into v_missing from expected_row e
        where e.tbl = v_table
          and not exists (select 1 from actual_row a where a.tbl = e.tbl and a.id = e.id);
        select count(*) into v_extra from actual_row a
        where a.tbl = v_table
          and not exists (select 1 from expected_row e where e.tbl = a.tbl and e.id = a.id);
        perform tests.ok(v_missing = 0 and v_extra = 0,
          format('%s read matches the capability function for %s at %s (missing %s, extra %s)',
                 v_table, v_user.user_id, v_level, v_missing, v_extra));
      end loop;

      perform tests.clear_auth();
    end loop;
    v_people := v_people + 1;
  end loop;

  perform tests.ok(v_people >= 5, format('compared %s people', v_people));

  -- Both sides exercised: the guest reads the granted project and program and
  -- the project inheriting the grant, not the closed ones.
  perform tests.authenticate(v_guest, 'aal1');
  perform tests.ok(
    exists (select 1 from public.project where id = v_granted_project)
      and exists (select 1 from public.project where name = 'Equivalence inherited')
      and exists (select 1 from public.program where id = v_granted_program)
      and exists (select 1 from public.milestone where name = 'eq: Equivalence granted')
      and not exists (select 1 from public.project where id = v_closed_project)
      and not exists (select 1 from public.program where id = v_closed_program)
      and not exists (select 1 from public.milestone where project_id = v_closed_project),
    'a granted guest reads the granted and inherited scopes, not a closed one'
  );
  perform tests.clear_auth();
end
$$;

rollback;
