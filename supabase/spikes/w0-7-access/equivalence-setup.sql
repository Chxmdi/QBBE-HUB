-- W0-7 equivalence: spike_access.can (app.can) against today's rules, for
-- every person, every task, project and program, at both assurance levels.
--
-- "Today's rules" are what the live policies decide:
--   view  task_read / project_read / program_read, observed as the person (a
--         row the person can select);
--   edit  task_scoped_update's USING clause: has_task_capability manage,
--         collaborate, review or approve; for a project or program, its
--         update policy: has_*_capability(id, 'manage');
--   and each underlying capability on its own (read, collaborate, review,
--   approve, manage), so a difference in the mapping cannot hide inside an OR.
-- The new side asks spike_access.can with the mapped capability:
--   view -> view; task edit -> edit_content; project/program edit -> manage;
--   collaborate -> run_workflow; review -> review; approve -> approve.
--
-- Four files, run in order by `node scripts/spikes/access-spike.mjs
-- equivalence`:
--   equivalence-setup.sql    this file: the comparison and the fixture
--   equivalence-compare.sql  one shard of the people; four run in parallel
--   equivalence-changes.sql  changes made through today's tables only
--   equivalence-report.sql   cache against a full rebuild, and the verdict
-- Round 1 compares the backfilled model; round 2 compares again after the
-- changes, which reach the new model only through the dual-write and cache
-- triggers.
--
-- Today's capability functions cost about 2 ms a call for a person without
-- access, and a round is about a million of them, so the people are split
-- across parallel sessions. Parallel sessions only see committed rows, so
-- UNLIKE the test suite this COMMITS its fixture and changes to the local
-- database. Reset afterwards: `npx supabase db reset && npm run db:seed`.
--
-- Needs: the spike applied, and the tests.* helpers (qa-users.sql and
-- rls.sql, which `npm run test:db` leaves in place).

do $$
begin
  if to_regprocedure('tests.authenticate(uuid, text)') is null then
    raise exception 'tests.authenticate is missing: run npm run test:db once first';
  end if;
  if to_regprocedure('spike_access.can(uuid, text)') is null then
    raise exception 'the spike is not applied: node scripts/spikes/access-spike.mjs apply';
  end if;
  if to_regclass('spike_access.eq_object') is not null then
    raise exception 'the equivalence fixture is already in this database: reset it first '
      '(npx supabase db reset && npm run db:seed, then the perf fixture and apply)';
  end if;
end
$$;

create table spike_access.eq_mismatch (
  round text, user_id uuid, aal text, object_kind text, object_id uuid,
  label text, capability text, today boolean, spike boolean
);
create table spike_access.eq_object (id uuid primary key, kind text, label text);
create table spike_access.eq_run (round text, shard integer, people integer, checks bigint, ms numeric);
grant all on spike_access.eq_mismatch, spike_access.eq_object, spike_access.eq_run
  to authenticated, anon;

-- Compare one shard of the people (and, in shard 0, a stranger) against every
-- object in eq_object.
create or replace function spike_access.eq_compare(p_round text, p_shard integer, p_shards integer)
returns void
language plpgsql
as $$
declare
  v_user record;
  v_level text;
  v_people integer := 0;
  v_started timestamptz := clock_timestamp();
  v_checks bigint := 0;
  v_levels integer := 0;
begin
  create temp table if not exists eq_visible (id uuid primary key);
  grant all on pg_temp.eq_visible to authenticated, anon;
  for v_user in
    select u.user_id, true as member
    from (select distinct m.user_id from public.organization_membership m) u
    where abs(hashtext(u.user_id::text)) % p_shards = p_shard
    union all
    select gen_random_uuid(), false where p_shard = 0
  loop
    foreach v_level in array case when v_user.member then array['aal1', 'aal2'] else array['aal1'] end loop
      perform tests.authenticate(v_user.user_id, v_level);
      -- What today's select policies let this person see, read once.
      truncate pg_temp.eq_visible;
      insert into pg_temp.eq_visible
      select id from public.task
      union all select id from public.project
      union all select id from public.program;
      insert into spike_access.eq_mismatch
      select p_round, v_user.user_id, v_level, e.kind, e.id, e.label, c.cap, c.today, c.spike
      from spike_access.eq_object e
      cross join lateral (
        select
          exists (select 1 from pg_temp.eq_visible v where v.id = e.id) as read,
          case e.kind when 'task' then public.has_task_capability(e.id, 'manage')
                      when 'project' then public.has_project_capability(e.id, 'manage')
                      else public.has_program_capability(e.id, 'manage') end as manage,
          case e.kind when 'task' then public.has_task_capability(e.id, 'collaborate')
                      when 'project' then public.has_project_capability(e.id, 'collaborate')
                      else public.has_program_capability(e.id, 'collaborate') end as collaborate,
          case e.kind when 'task' then public.has_task_capability(e.id, 'review')
                      when 'project' then public.has_project_capability(e.id, 'review')
                      else public.has_program_capability(e.id, 'review') end as review,
          case e.kind when 'task' then public.has_task_capability(e.id, 'approve')
                      when 'project' then public.has_project_capability(e.id, 'approve')
                      else public.has_program_capability(e.id, 'approve') end as approve
      ) as old
      cross join lateral (values
        ('view', old.read, spike_access.can(e.id, 'view')),
        ('edit',
          case when e.kind = 'task' then old.manage or old.collaborate or old.review or old.approve
               else old.manage end,
          spike_access.can(e.id, case when e.kind = 'task' then 'edit_content' else 'manage' end)),
        ('manage', old.manage, spike_access.can(e.id, 'manage')),
        ('collaborate', old.collaborate, spike_access.can(e.id, 'run_workflow')),
        ('review', old.review, spike_access.can(e.id, 'review')),
        ('approve', old.approve, spike_access.can(e.id, 'approve'))
      ) as c (cap, today, spike)
      where c.today is distinct from c.spike;
      perform tests.clear_auth();
      perform set_config('role', 'postgres', true);
      v_levels := v_levels + 1;
    end loop;
    v_people := v_people + 1;
  end loop;
  select count(*) * 6 * v_levels into v_checks from spike_access.eq_object;
  insert into spike_access.eq_run values (
    p_round, p_shard, v_people, v_checks,
    round(extract(epoch from clock_timestamp() - v_started)::numeric * 1000));
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture: every path in, and the paths that must not lead in, on top of the
-- seed and the 2,000-task performance fixture.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_lv uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000010';  -- perf staff, made leadership viewer
  v_acct uuid := 'cccccccc-cccc-cccc-cccc-000000000001'; -- external accountant (guest)
  v_org uuid;
  v_prog_roles uuid;
  v_proj_roles uuid;
  v_closed_program uuid;
  v_closed_project uuid;
  v_orphan_project uuid;
  v_mixed_project uuid;
  v_task uuid;
  v_role text;
  v_person uuid;
  i integer := 0;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_guest, v_admin);
  update public.organization_membership set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_lv;

  -- The external accountant: a Guest with a current ledger grant. Sign-up is
  -- by invitation only, as for everyone.
  insert into public.invitation (organization_id, email, intended_role, invited_by, expires_at)
  select v_org, 'qa-accountant@example.com', 'guest', v_owner, now() + interval '30 days'
  where not exists (select 1 from auth.users u where u.email = 'qa-accountant@example.com');
  perform tests.ensure_auth_user(v_acct, 'qa-accountant@example.com', 'QA Accountant');
  insert into public.organization_membership (organization_id, user_id, role, status)
  values (v_org, v_acct, 'guest', 'active')
  on conflict (organization_id, user_id) do update set role = 'guest', status = 'active';
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_acct, now() + interval '90 days', v_owner);

  -- A program with one person per program role, and a project under it with
  -- one person per project role (volunteers 11..22 of the perf fixture).
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Eq roles program', 'eq-roles-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_prog_roles;
  foreach v_role in array array['lead', 'manager', 'contributor', 'reviewer', 'follower', 'read_only'] loop
    i := i + 1;
    v_person := ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad((10 + i)::text, 12, '0'))::uuid;
    insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
    values (v_org, v_prog_roles, v_person, v_role::public.program_access_role, 'direct', v_owner);
  end loop;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_prog_roles, 'Eq roles project', v_owner, v_owner)
  returning id into v_proj_roles;
  foreach v_role in array array['project_manager', 'contributor', 'reviewer', 'approver', 'follower', 'read_only'] loop
    i := i + 1;
    v_person := ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad((10 + i)::text, 12, '0'))::uuid;
    insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
    values (v_org, v_proj_roles, v_person, v_role::public.project_access_role, 'direct', v_owner);
  end loop;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_proj_roles, 'eq: roles project task', v_owner);
  insert into public.task (organization_id, program_id, title, created_by)
  values (v_org, v_prog_roles, 'eq: roles program-level task', v_owner);

  -- A program and project nobody below owner/admin reaches, a project with no
  -- program, and a project task whose own program_id names another program.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Eq closed', 'eq-closed-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_closed_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_closed_program, 'Eq closed project', v_owner, v_owner)
  returning id into v_closed_project;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Eq no-program project', v_staff, v_owner)
  returning id into v_orphan_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_orphan_project, 'eq: no-program project task', v_owner),
         (v_org, v_closed_project, 'eq: closed project task', v_owner);
  insert into public.task (organization_id, program_id, title, created_by)
  values (v_org, v_closed_program, 'eq: closed program-level task', v_owner);
  insert into public.task (organization_id, title, created_by)
  values (v_org, 'eq: organization-level task', v_owner);
  select id into v_mixed_project from public.project where name = 'Perf Project 01';
  begin
    insert into public.task (organization_id, project_id, program_id, title, created_by)
    values (v_org, v_mixed_project, v_prog_roles, 'eq: project task naming another program', v_owner);
  exception when others then
    raise notice 'skipped the mixed program/project task: %', sqlerrm;
  end;

  -- Actor columns and every assignment role, on a closed project's tasks.
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_closed_project, 'eq: assignee column', v_owner, v_guest);
  insert into public.task (organization_id, project_id, title, created_by, requester_id)
  values (v_org, v_closed_project, 'eq: requester column', v_owner, v_guest);
  insert into public.task (organization_id, project_id, title, created_by, reviewer_id)
  values (v_org, v_closed_project, 'eq: reviewer column', v_owner, v_volunteer);
  insert into public.task (organization_id, project_id, title, created_by, approver_id)
  values (v_org, v_closed_project, 'eq: approver column', v_owner, v_volunteer);
  foreach v_role in array array['contributor', 'reviewer', 'approver', 'follower'] loop
    insert into public.task (organization_id, project_id, title, created_by)
    values (v_org, v_closed_project, 'eq: assignment ' || v_role, v_owner)
    returning id into v_task;
    insert into public.task_assignment (task_id, user_id, role) values (v_task, v_guest, v_role);
  end loop;
  -- The accountant is assigned one task: the only task access they have.
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_closed_project, 'eq: accountant assignee', v_owner, v_acct);

  insert into spike_access.eq_object select t.id, 'task', t.title from public.task t;
  insert into spike_access.eq_object select p.id, 'project', p.name from public.project p;
  insert into spike_access.eq_object select p.id, 'program', p.name from public.program p;
end
$$;

