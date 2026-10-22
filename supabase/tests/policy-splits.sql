-- The write policies split into INSERT, UPDATE and DELETE allow exactly what
-- the single FOR ALL policy each replaced allowed (reads included, since a FOR
-- ALL policy also grants reading), for every QA role, and the
-- admin audit log is still readable only by owners and admins who completed
-- MFA, for their own organization. Run after qa-users.sql and rls.sql.
-- Rolled back.
--
-- How "no wider" is proven: every read and write (insert, update, delete, and moving a
-- row to another project, task or team) is tried as every role on fixture
-- rows inside and outside the organization; then the old FOR ALL policies are
-- put back and the same writes are tried again. The two sets of outcomes must
-- be identical. Both runs use whatever helper functions (is_org_admin,
-- has_project_capability, ...) are installed, so the proof holds whatever
-- those helpers become.
begin;

create function tests.policy_write_matrix(p_rows jsonb, p_moves jsonb)
returns text[]
language plpgsql
as $$
declare
  v_users uuid[] := array[
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9']::uuid[];
  v_callers text[];
  v_caller text;
  v_entry jsonb;
  v_table text;
  v_row jsonb;
  v_move jsonb;
  v_rows integer;
  v_result text;
  v_out text[] := '{}';
  v_key text;
begin
  -- Every role with MFA, and the owner and the admin without it.
  select array_agg(u::text || ':aal2') into v_callers from unnest(v_users) u;
  v_callers := v_callers || array[v_users[1]::text || ':aal1', v_users[4]::text || ':aal1'];

  for v_entry in select value from jsonb_array_elements(p_rows) loop
    v_table := v_entry ->> 'table';
    v_row := v_entry -> 'row';
    v_move := p_moves -> v_table;
    v_key := v_table || '|' || md5(v_row::text);
    foreach v_caller in array v_callers loop
      -- Read.
      begin
        perform tests.authenticate(split_part(v_caller, ':', 1)::uuid, split_part(v_caller, ':', 2));
        execute format('select count(*) from public.%I t where to_jsonb(t) = $1', v_table) into v_rows using v_row;
        raise exception using errcode = 'QTUND', message = v_rows::text;
      exception
        when sqlstate 'QTUND' then v_result := 'rows ' || sqlerrm;
        when others then v_result := 'error ' || sqlstate;
      end;
      v_out := v_out || (v_key || '|read|' || v_caller || '|' || v_result);

      -- Update in place.
      begin
        perform tests.authenticate(split_part(v_caller, ':', 1)::uuid, split_part(v_caller, ':', 2));
        execute format('update public.%I t set %I = t.%I where to_jsonb(t) = $1', v_table, v_move ->> 'column', v_move ->> 'column')
          using v_row;
        get diagnostics v_rows = row_count;
        raise exception using errcode = 'QTUND', message = v_rows::text;
      exception
        when sqlstate 'QTUND' then v_result := 'rows ' || sqlerrm;
        when others then v_result := 'error ' || sqlstate;
      end;
      v_out := v_out || (v_key || '|update|' || v_caller || '|' || v_result);

      -- Move it to another project, task or team.
      begin
        perform tests.authenticate(split_part(v_caller, ':', 1)::uuid, split_part(v_caller, ':', 2));
        execute format('update public.%I t set %I = $2::uuid where to_jsonb(t) = $1', v_table, v_move ->> 'column')
          using v_row, v_move ->> 'to';
        get diagnostics v_rows = row_count;
        raise exception using errcode = 'QTUND', message = v_rows::text;
      exception
        when sqlstate 'QTUND' then v_result := 'rows ' || sqlerrm;
        when others then v_result := 'error ' || sqlstate;
      end;
      v_out := v_out || (v_key || '|move|' || v_caller || '|' || v_result);

      -- Delete.
      begin
        perform tests.authenticate(split_part(v_caller, ':', 1)::uuid, split_part(v_caller, ':', 2));
        execute format('delete from public.%I t where to_jsonb(t) = $1', v_table) using v_row;
        get diagnostics v_rows = row_count;
        raise exception using errcode = 'QTUND', message = v_rows::text;
      exception
        when sqlstate 'QTUND' then v_result := 'rows ' || sqlerrm;
        when others then v_result := 'error ' || sqlstate;
      end;
      v_out := v_out || (v_key || '|delete|' || v_caller || '|' || v_result);

      -- Insert: the row is removed as the database owner, then the caller
      -- writes the same values back.
      begin
        execute format('delete from public.%I t where to_jsonb(t) = $1', v_table) using v_row;
        perform tests.authenticate(split_part(v_caller, ':', 1)::uuid, split_part(v_caller, ':', 2));
        execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', v_table, v_table)
          using v_row;
        get diagnostics v_rows = row_count;
        raise exception using errcode = 'QTUND', message = v_rows::text;
      exception
        when sqlstate 'QTUND' then v_result := 'rows ' || sqlerrm;
        when others then v_result := 'error ' || sqlstate;
      end;
      v_out := v_out || (v_key || '|insert|' || v_caller || '|' || v_result);
    end loop;
  end loop;
  return v_out;
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_lead uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_org uuid;
  v_other_org uuid;
  v_project uuid;
  v_plain_project uuid;
  v_program_project uuid;
  v_other_project uuid;
  v_meeting uuid;
  v_task uuid;
  v_plain_task uuid;
  v_team uuid;
  v_other_team uuid;
  v_rows jsonb := '[]';
  v_moves jsonb;
  v_table text;
  v_after text[];
  v_before text[];
  v_allowed integer;
  v_refused integer;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;

  -- Fixtures, as the database owner: a second organization, a project the
  -- scoped lead manages (from qa-scoped-grants.sql) and one nobody special
  -- does, a meeting, tasks, teams, and a row of each kind in each place.
  insert into organization (name, slug) values ('Zzpolicy Other Org', 'zzpolicy-other-' || txid_current())
    returning id into v_other_org;
  -- The project qa-pm manages, and one in the program qa-lead leads.
  select id into v_project from project where organization_id = v_org and name = 'Fall Community Workshop Series' limit 1;
  select p.id into v_program_project from project p join program g on g.id = p.program_id
    where p.organization_id = v_org and g.slug = 'family-first' limit 1;
  insert into project (organization_id, name) values (v_org, 'Zzpolicy plain project') returning id into v_plain_project;
  perform tests.ok(v_project is not null and v_program_project is not null,
    'policy splits fixture: the scoped QA grants are in place');
  insert into project (organization_id, name) values (v_other_org, 'Zzpolicy other project') returning id into v_other_project;
  insert into meeting (organization_id, title, organizer_id, starts_at)
    values (v_org, 'Zzpolicy meeting', v_staff, now() + interval '1 day') returning id into v_meeting;
  insert into task (organization_id, project_id, title, created_by) values (v_org, v_project, 'Zzpolicy task', v_owner)
    returning id into v_task;
  insert into task (organization_id, project_id, title, created_by) values (v_org, v_plain_project, 'Zzpolicy plain task', v_owner)
    returning id into v_plain_task;
  insert into team (organization_id, name, owner_id) values (v_org, 'Zzpolicy team', v_staff) returning id into v_team;
  insert into team (organization_id, name, owner_id) values (v_org, 'Zzpolicy team two', v_owner) returning id into v_other_team;

  insert into decision (organization_id, title, meeting_id) values (v_org, 'Zzpolicy meeting decision', v_meeting);
  insert into decision (organization_id, title, project_id) values (v_org, 'Zzpolicy project decision', v_project);
  insert into decision (organization_id, title) values (v_org, 'Zzpolicy organization decision');
  insert into decision (organization_id, title, project_id) values (v_other_org, 'Zzpolicy other decision', v_other_project);
  insert into issue (organization_id, project_id, title) values (v_org, v_project, 'Zzpolicy issue');
  insert into issue (organization_id, project_id, title) values (v_org, v_plain_project, 'Zzpolicy plain issue');
  insert into issue (organization_id, project_id, title) values (v_other_org, v_other_project, 'Zzpolicy other issue');
  insert into risk (organization_id, project_id, title) values (v_org, v_project, 'Zzpolicy risk');
  insert into risk (organization_id, project_id, title) values (v_org, v_plain_project, 'Zzpolicy plain risk');
  insert into risk (organization_id, project_id, title) values (v_other_org, v_other_project, 'Zzpolicy other risk');
  insert into decision (organization_id, title, project_id) values (v_org, 'Zzpolicy program decision', v_program_project);
  insert into issue (organization_id, project_id, title) values (v_org, v_program_project, 'Zzpolicy program issue');
  insert into risk (organization_id, project_id, title) values (v_org, v_program_project, 'Zzpolicy program risk');
  insert into task_assignment (task_id, user_id, role) values (v_task, v_staff, 'contributor');
  insert into task_assignment (task_id, user_id, role) values (v_plain_task, v_lead, 'reviewer');
  insert into team_member (team_id, user_id, organization_id) values (v_team, v_staff, v_org);
  insert into team_member (team_id, user_id, organization_id) values (v_other_team, v_lead, v_org);

  -- Every row of the six tables in the two organizations (the seed's own
  -- rows included), and where a move takes each kind.
  foreach v_table in array array['decision', 'issue', 'risk', 'team', 'team_member'] loop
    execute format(
      $q$select coalesce(jsonb_agg(jsonb_build_object('table', %L, 'row', to_jsonb(t))), '[]') from public.%I t
         where t.organization_id in ($1, $2)$q$, v_table, v_table)
      into strict v_table using v_org, v_other_org;
    v_rows := v_rows || v_table::jsonb;
  end loop;
  v_rows := v_rows || (
    select coalesce(jsonb_agg(jsonb_build_object('table', 'task_assignment', 'row', to_jsonb(ta))), '[]')
    from public.task_assignment ta join public.task t on t.id = ta.task_id
    where t.organization_id in (v_org, v_other_org));
  v_moves := jsonb_build_object(
    'decision', jsonb_build_object('column', 'project_id', 'to', v_plain_project),
    'issue', jsonb_build_object('column', 'project_id', 'to', v_plain_project),
    'risk', jsonb_build_object('column', 'project_id', 'to', v_plain_project),
    'task_assignment', jsonb_build_object('column', 'task_id', 'to', v_plain_task),
    'team', jsonb_build_object('column', 'organization_id', 'to', v_other_org),
    'team_member', jsonb_build_object('column', 'team_id', 'to', v_other_team));

  -- No FOR ALL write policy is left on these tables, and every split UPDATE
  -- policy checks the new row as well as the old one.
  perform tests.ok(not exists (
    select 1 from pg_policies where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE'
      and tablename in ('decision', 'issue', 'risk', 'task_assignment', 'team', 'team_member')
      and 'authenticated' = any (roles)),
    'policy splits: no FOR ALL write policy is left on decision, issue, risk, task_assignment, team or team_member');
  perform tests.ok(not exists (
    select 1 from pg_policies where schemaname = 'public' and cmd = 'UPDATE'
      and policyname in ('decision_scoped_update', 'issue_manage_update', 'risk_manage_update',
        'task_assignment_update', 'team_admin_update', 'team_member_admin_update')
      and (with_check is null or with_check <> qual)),
    'policy splits: every split UPDATE policy checks the new row with the same rule as the old one');
  perform tests.ok((
    select count(*) from pg_policies where schemaname = 'public'
      and policyname in (
        'decision_scoped_insert', 'decision_scoped_update', 'decision_scoped_delete',
        'issue_manage_insert', 'issue_manage_update', 'issue_manage_delete',
        'risk_manage_insert', 'risk_manage_update', 'risk_manage_delete',
        'task_assignment_insert', 'task_assignment_update', 'task_assignment_delete',
        'team_admin_insert', 'team_admin_update', 'team_admin_delete',
        'team_member_admin_insert', 'team_member_admin_update', 'team_member_admin_delete')) = 18,
    'policy splits: all eighteen split policies exist');

  -- After: the split policies.
  v_after := tests.policy_write_matrix(v_rows, v_moves);

  -- Before: the six FOR ALL policies exactly as they were (copied from the
  -- migrations that created them), so a later change to a split policy that
  -- widens or narrows it fails here.
  drop policy decision_scoped_insert on public.decision;
  drop policy decision_scoped_update on public.decision;
  drop policy decision_scoped_delete on public.decision;
  create policy decision_scoped_write on public.decision for all to authenticated
    using (((meeting_id is not null) and app.can_manage_meeting(meeting_id))
      or ((project_id is not null) and app.has_project_capability(project_id, 'manage'::text))
      or app.is_org_admin(organization_id))
    with check (((meeting_id is not null) and app.can_manage_meeting(meeting_id))
      or ((project_id is not null) and app.has_project_capability(project_id, 'manage'::text))
      or app.is_org_admin(organization_id));
  drop policy issue_manage_insert on public.issue;
  drop policy issue_manage_update on public.issue;
  drop policy issue_manage_delete on public.issue;
  create policy issue_manage on public.issue for all to authenticated
    using (app.can_manage_project(project_id)) with check (app.can_manage_project(project_id));
  drop policy risk_manage_insert on public.risk;
  drop policy risk_manage_update on public.risk;
  drop policy risk_manage_delete on public.risk;
  create policy risk_manage on public.risk for all to authenticated
    using (app.can_manage_project(project_id)) with check (app.can_manage_project(project_id));
  drop policy task_assignment_insert on public.task_assignment;
  drop policy task_assignment_update on public.task_assignment;
  drop policy task_assignment_delete on public.task_assignment;
  create policy task_assignment_write on public.task_assignment for all to authenticated
    using (public.has_task_capability(task_id, 'manage'::text))
    with check (public.has_task_capability(task_id, 'manage'::text));
  drop policy team_admin_insert on public.team;
  drop policy team_admin_update on public.team;
  drop policy team_admin_delete on public.team;
  create policy team_admin_write on public.team for all to authenticated
    using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));
  drop policy team_member_admin_insert on public.team_member;
  drop policy team_member_admin_update on public.team_member;
  drop policy team_member_admin_delete on public.team_member;
  create policy team_member_admin_write on public.team_member for all to authenticated
    using (app.can_manage_team(team_id)) with check (app.can_manage_team(team_id));

  v_before := tests.policy_write_matrix(v_rows, v_moves);

  select count(*) filter (where c like '%|rows 1'), count(*) filter (where c not like '%|rows 1')
    into v_allowed, v_refused from unnest(v_after) c;
  perform tests.ok(v_allowed > 0 and v_refused > 0 and cardinality(v_after) > 1000,
    format('policy splits: the matrix covers allowed and refused writes (%s allowed, %s refused)', v_allowed, v_refused));
  perform tests.ok(v_after = v_before,
    'policy splits: every role may write exactly what the FOR ALL policies allowed: '
    || coalesce((select string_agg(a, '; ') from (
         select a from unnest(v_after) a except select b from unnest(v_before) b limit 5) d), 'no difference'));
end;
$$;

-- The audit log: owners and admins who completed MFA, their own organization only.
do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_other_org uuid;
  v_total bigint;
  n bigint;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  insert into organization (name, slug) values ('Zzaudit Other Org', 'zzaudit-other-' || txid_current())
    returning id into v_other_org;
  insert into audit_event (organization_id, actor_type, event_type, action, object_type)
  values (v_org, 'system', 'zzaudit.probe', 'probe', 'organization'),
         (v_other_org, 'system', 'zzaudit.probe', 'probe', 'organization'),
         (null, 'system', 'zzaudit.probe', 'probe', 'organization');
  select count(*) into v_total from audit_event where organization_id = v_org;

  perform tests.authenticate(v_owner, 'aal2');
  select count(*) into n from audit_event;
  perform tests.ok(n = v_total, 'audit log: an owner with MFA reads every event of their organization, none of another and none without one');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into n from audit_event;
  perform tests.ok(n = v_total, 'audit log: an admin with MFA reads their organization''s events');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  select count(*) into n from audit_event;
  perform tests.ok(n = 0, 'audit log: an owner without MFA reads nothing');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate(v_admin, 'aal1');
  select count(*) into n from audit_event;
  perform tests.ok(n = 0, 'audit log: an admin with an aal1 session reads nothing');
  perform tests.clear_auth();
  reset role;

  -- An aal2 claim without a verified authenticator is not MFA.
  delete from auth.mfa_factors where user_id = v_admin;
  perform tests.authenticate(v_admin, 'aal1');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated', 'email', '', 'aal', 'aal2')::text, true);
  select count(*) into n from audit_event;
  perform tests.ok(n = 0, 'audit log: an aal2 claim without a verified authenticator reads nothing');
  perform tests.clear_auth();
  reset role;

  -- A deactivated admin, even with MFA, reads nothing.
  update organization_membership set status = 'deactivated' where user_id = v_admin and organization_id = v_org;
  perform tests.authenticate(v_admin, 'aal2');
  select count(*) into n from audit_event;
  perform tests.ok(n = 0, 'audit log: a deactivated admin with MFA reads nothing');
  perform tests.clear_auth();
  reset role;
  update organization_membership set status = 'active' where user_id = v_admin and organization_id = v_org;

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aal2');
  select count(*) into n from audit_event;
  perform tests.ok(n = 0, 'audit log: staff read nothing');
  perform tests.clear_auth();
  reset role;

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'aal2');
  select count(*) into n from audit_event;
  perform tests.ok(n = 0, 'audit log: a guest reads nothing');
  perform tests.clear_auth();
  reset role;

  perform tests.ok(
    not has_function_privilege('anon', 'app.my_admin_organization_ids()', 'execute')
      and not exists (select 1 from information_schema.routine_privileges
        where routine_schema = 'app' and routine_name = 'my_admin_organization_ids' and grantee = 'PUBLIC'),
    'audit log: signed-out visitors cannot call the admin-organizations helper');
  perform tests.ok(
    (select qual from pg_policies where tablename = 'audit_event' and policyname = 'audit_admin_read')
      like '%my_admin_organization_ids%',
    'audit log: the read policy checks the caller''s admin organizations once, not once per row');
end;
$$;

rollback;
