-- Insight what-if timeline (V3-4, epic #199): public.insight_apply_schedule_shift.
--
-- Pins who may apply a milestone shift (a project manager, the owner, an
-- admin with two-step sign-in) and who may not (a read-only volunteer, a
-- member with no access, the external accountant, an admin without two-step
-- sign-in, a signed-out visitor), that a refused or stale shift changes
-- nothing at all, and that an allowed one moves every row in one go.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_project uuid;
  v_milestone uuid;
  v_task uuid;
  v_role record;
  v_moves jsonb;
  v_tasks jsonb;
  n integer;
  v_state text;
  v_due date;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'What-if project', v_owner, v_owner) returning id into v_project;
  insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  values (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner),
         (v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner);
  insert into public.milestone (project_id, name, due_date)
  values (v_project, 'Venue booked', date '2026-11-01') returning id into v_milestone;
  insert into public.task (organization_id, project_id, milestone_id, title, due_at, created_by)
  values (v_org, v_project, v_milestone, 'Book the hall', date '2026-10-30', v_owner) returning id into v_task;

  v_moves := jsonb_build_array(jsonb_build_object('id', v_milestone, 'from', '2026-11-01', 'to', '2026-11-08'));
  v_tasks := jsonb_build_array(jsonb_build_object('id', v_task, 'from', '2026-10-30', 'to', '2026-11-06'));

  -- Refused: every role that cannot manage the project. Nothing moves.
  for v_role in select * from (values
      (v_volunteer, 'aal2', 'a read-only volunteer'),
      (v_member, 'aal2', 'a member with no access'),
      (v_guest, 'aal2', 'the accountant'),
      (v_admin, 'aal1', 'an admin without two-step sign-in')) as r(uid, aal, name) loop
    perform tests.authenticate(v_role.uid, v_role.aal);
    begin
      perform public.insight_apply_schedule_shift(v_moves, v_tasks);
      v_state := 'none';
    exception when others then
      v_state := sqlstate;
    end;
    reset role;
    select due_date into v_due from public.milestone where id = v_milestone;
    perform tests.ok(v_state = '42501' and v_due = date '2026-11-01', v_role.name || ' cannot apply a shift, and nothing moves');
  end loop;

  -- Signed out: the function is not even callable.
  perform tests.clear_auth();
  begin
    perform public.insight_apply_schedule_shift(v_moves, v_tasks);
    v_state := 'none';
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  perform tests.ok(v_state = '42501', 'signed-out: refused');

  -- A stale preview: the task's date changed after it. Nothing moves, not
  -- even the milestone that still matched.
  perform tests.authenticate(v_staff);
  begin
    perform public.insight_apply_schedule_shift(v_moves,
      jsonb_build_array(jsonb_build_object('id', v_task, 'from', '2026-10-29', 'to', '2026-11-05')));
    v_state := 'none';
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  select due_date into v_due from public.milestone where id = v_milestone;
  perform tests.ok(v_state = '40001' and v_due = date '2026-11-01', 'a stale preview is refused as a whole');

  -- Allowed: the project manager moves both rows in one call.
  perform tests.authenticate(v_staff);
  select public.insight_apply_schedule_shift(v_moves, v_tasks) into n;
  reset role;
  perform tests.ok(n = 2, 'a project manager applies the shift');
  select count(*) into n from public.milestone m join public.task t on t.milestone_id = m.id
   where m.id = v_milestone and m.due_date = date '2026-11-08' and t.due_at = date '2026-11-06';
  perform tests.ok(n = 1, 'the milestone and its task both moved');

  -- Owner and admin (two-step) may apply too; move it back and forth.
  for v_role in select * from (values (v_owner, 'owner'), (v_admin, 'admin')) as r(uid, name) loop
    perform tests.authenticate(v_role.uid);
    select public.insight_apply_schedule_shift(
      jsonb_build_array(jsonb_build_object('id', v_milestone, 'from', '2026-11-08', 'to', '2026-11-09')), '[]') into n;
    perform public.insight_apply_schedule_shift(
      jsonb_build_array(jsonb_build_object('id', v_milestone, 'from', '2026-11-09', 'to', '2026-11-08')), '[]');
    reset role;
    perform tests.ok(n = 1, v_role.name || ' applies a shift');
  end loop;

  -- Malformed input is refused before anything is read.
  perform tests.authenticate(v_staff);
  begin
    perform public.insight_apply_schedule_shift('{}'::jsonb, '[]');
    v_state := 'none';
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  perform tests.ok(v_state = '22023', 'a malformed change is refused');
end;
$$;

rollback;
