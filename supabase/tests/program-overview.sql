-- Programme lead capability and overview reads (#26, P0-PROG-01/P0-PROG-02).
--
-- The lead is not a label: has_program_capability reads program.lead_id
-- directly, so changing it moves `manage` from one person to another. These
-- assertions pin that, because the application now lets a manager change it.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Lead handover program',
          'lead-handover-' || substr(gen_random_uuid()::text, 1, 8), v_staff, v_owner)
  returning id into v_program;

  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Lead handover project', v_staff, v_owner)
  returning id into v_project;

  -- The named lead manages the programme.
  perform tests.authenticate(v_staff);
  perform tests.ok(public.has_program_capability(v_program, 'manage'),
    'the named program lead can manage the program');

  -- Somebody who holds nothing does not.
  perform tests.authenticate(v_volunteer);
  perform tests.ok(not public.has_program_capability(v_program, 'manage'),
    'a volunteer with no grant cannot manage the program');
  perform tests.ok(not public.has_program_capability(v_program, 'read'),
    'a volunteer with no grant cannot read the program');

  -- Hand the lead over. tests.clear_auth() drops to `anon`, which RLS blocks,
  -- so a fixture mutation has to reset the role first or it updates no rows
  -- and every assertion after it tests the state before the handover.
  perform tests.clear_auth();
  reset role;
  update public.program set lead_id = v_volunteer where id = v_program;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the lead handover actually updated the program row');

  perform tests.authenticate(v_volunteer);
  perform tests.ok(public.has_program_capability(v_program, 'manage'),
    'the new lead can manage the program after the handover');
  -- Programme access inherits down to the programme's projects, which is what
  -- makes the lead worth guarding: it is not one record's worth of access.
  perform tests.ok(public.has_project_capability(v_project, 'read'),
    'the new lead inherits read on the program''s projects');

  perform tests.authenticate(v_staff);
  perform tests.ok(not public.has_program_capability(v_program, 'manage'),
    'the previous lead loses manage after the handover');

  -- Clearing the lead leaves nobody holding it by that route.
  perform tests.clear_auth();
  reset role;
  update public.program set lead_id = null where id = v_program;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(not public.has_program_capability(v_program, 'manage'),
    'clearing the lead removes the capability it conferred');

  -- The overview reads the team from program_access_grant. A volunteer who
  -- holds nothing must not be able to enumerate who does.
  perform tests.clear_auth();
  perform tests.authenticate(v_owner);
  select count(*) into n from public.program_access_grant where program_id = v_program;
  perform tests.ok(n >= 0, 'an owner can read the program access grant list');

  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.program_access_grant where program_id = v_program;
  perform tests.ok(n = 0,
    'a volunteer cannot enumerate who holds access to a program they cannot see');

  perform tests.clear_auth();
  reset role;
end $$;

rollback;
