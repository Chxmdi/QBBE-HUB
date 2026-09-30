-- Workspace OS admin controls (V2-9): sign-in rules per role, the session
-- check, and the "what can this role see" report. Every role, and signed out.
-- Run after qa-users.sql and rls.sql. Rolled back.
begin;

create function tests.ac_raises(p_sql text, p_pattern text, p_msg text)
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
grant execute on function tests.ac_raises(text, text, text) to authenticated, anon;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_new_org uuid;
  v_rows integer;
  v_status jsonb;
  v_report jsonb;
  v_session uuid := gen_random_uuid();
  v_who uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer' where organization_id = v_org and user_id = v_viewer;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '1 day', v_admin);

  -- Every organization has a rule for every role; owners and admins need MFA.
  perform tests.ok(
    (select count(*) from public.sign_in_rule where organization_id = v_org) = cardinality(enum_range(null::public.org_role))
      and (select bool_and(require_mfa) from public.sign_in_rule where organization_id = v_org and role in ('owner', 'admin'))
      and not (select bool_or(require_mfa) from public.sign_in_rule where organization_id = v_org and role not in ('owner', 'admin')),
    'every role has a rule; today''s: owners and admins need two-step sign-in, nobody else');
  insert into public.organization (name, slug) values ('Rules org', 'rules-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_new_org;
  perform tests.ok((select count(*) from public.sign_in_rule where organization_id = v_new_org) > 0,
    'a new organization gets its rules at once');
  perform tests.ac_raises(format('update public.sign_in_rule set require_mfa = false where organization_id = %L and role = ''admin''', v_org),
    'sign_in_rule_admins_need_mfa', 'two-step sign-in cannot be turned off for owners and admins, even by the service');

  -- Who may change rules.
  foreach v_who in array array[v_staff, v_viewer, v_volunteer, v_guest] loop
    perform tests.authenticate(v_who);
    update public.sign_in_rule set require_mfa = true where organization_id = v_org and role = 'staff';
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 0, 'only owners and admins change sign-in rules (not ' ||
      case v_who when v_staff then 'staff' when v_viewer then 'a leadership viewer' when v_volunteer then 'a volunteer'
        else 'a guest or accountant' end || ')');
    select count(*) into v_rows from public.sign_in_rule where organization_id = v_org;
    perform tests.ok(v_rows > 0, 'every member can read the rules that apply to them');
    reset role;
  end loop;
  perform tests.authenticate(v_admin, 'aal1');
  update public.sign_in_rule set require_mfa = true where organization_id = v_org and role = 'staff';
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'an admin without two-step sign-in cannot change them');
  reset role;

  perform tests.authenticate(v_admin);
  update public.sign_in_rule set require_mfa = true, max_session_hours = 8 where organization_id = v_org and role = 'staff';
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 1, 'an admin with two-step sign-in requires it for staff and limits sessions to 8 hours');
  perform tests.ac_raises(format('update public.sign_in_rule set role = ''guest'' where organization_id = %L and role = ''staff''', v_org),
    'permission denied', 'which role a rule is for cannot be changed');
  reset role;
  perform tests.ok(exists (
    select 1 from public.audit_event where organization_id = v_org and action = 'sign_in_rule_changed'
      and metadata ->> 'role' = 'staff' and actor_id = v_admin),
    'changing a rule is recorded in the audit log, with who did it');

  -- The session check.
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v_session, v_staff, now() - interval '9 hours', now(), 'aal1');
  perform tests.authenticate(v_staff, 'aal1');
  perform set_config('request.jwt.claims',
    (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('session_id', v_session))::text, true);
  v_status := public.my_sign_in_status();
  perform tests.ok((v_status ->> 'require_mfa')::boolean and not (v_status ->> 'mfa_ok')::boolean
      and not (v_status ->> 'session_ok')::boolean,
    'staff without two-step sign-in, 9 hours into an 8-hour session: both rules are unmet');
  reset role;
  update auth.sessions set created_at = now() - interval '1 hour' where id = v_session;
  perform tests.authenticate(v_staff, 'aal2');
  perform set_config('request.jwt.claims',
    (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('session_id', v_session))::text, true);
  v_status := public.my_sign_in_status();
  perform tests.ok((v_status ->> 'mfa_ok')::boolean and (v_status ->> 'session_ok')::boolean,
    'with two-step sign-in, an hour in: both rules are met');
  reset role;
  perform tests.authenticate(v_volunteer, 'aal1');
  v_status := public.my_sign_in_status();
  perform tests.ok((v_status ->> 'mfa_ok')::boolean and (v_status ->> 'session_ok')::boolean,
    'a volunteer has no extra rule');
  reset role;

  -- The report.
  foreach v_who in array array[v_staff, v_viewer, v_volunteer, v_guest] loop
    perform tests.authenticate(v_who);
    perform tests.ac_raises('select public.role_visibility_report(''staff'')', 'owner or administrator',
      'only owners and admins see the role report');
    reset role;
  end loop;
  perform tests.authenticate(v_owner);
  v_report := public.role_visibility_report('staff');
  perform tests.ok(
    (select e -> 'capabilities' from jsonb_array_elements(v_report -> 'spaces') e where e ->> 'kind' = 'workspace')
      = '["view", "comment", "edit_content"]'::jsonb
      and not exists (select 1 from jsonb_array_elements(v_report -> 'spaces') e where e ->> 'kind' = 'private'),
    'the report shows what staff can do in the Workspace, and never lists private spaces');
  v_report := public.role_visibility_report('leadership_viewer');
  perform tests.ok(
    (v_report -> 'counts' -> 'tasks' ->> 'visible')::int = (v_report -> 'counts' -> 'tasks' ->> 'total')::int
      and (v_report -> 'counts' -> 'projects' ->> 'visible')::int = (v_report -> 'counts' -> 'projects' ->> 'total')::int,
    'a leadership viewer, by role alone, sees every project and task');
  v_report := public.role_visibility_report('volunteer');
  perform tests.ok(
    (v_report -> 'counts' -> 'tasks' ->> 'visible')::int = 0
      and not exists (select 1 from jsonb_array_elements(v_report -> 'spaces') e
                      where jsonb_array_length(e -> 'capabilities') > 0),
    'a volunteer, by role alone, sees no task and no space (personal grants come on top)');
  reset role;
end;
$$;

-- Signed out: none of it.
do $$
begin
  perform tests.clear_auth();
  perform tests.ac_raises('select count(*) from public.sign_in_rule', 'permission denied', 'a visitor cannot read sign-in rules');
  perform tests.ac_raises('select public.my_sign_in_status()', 'permission denied', 'a visitor cannot call the session check');
  perform tests.ac_raises('select public.role_visibility_report(''staff'')', 'permission denied', 'a visitor cannot see the role report');
  reset role;
end;
$$;

rollback;
