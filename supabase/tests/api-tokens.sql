-- Workspace OS S6 V2-8 (20261106010004_api_tokens): private API tokens, the
-- call log, and objects listed as the token's person. Allow and deny for every
-- role. Run after qa-users.sql and rls.sql. All mutations roll back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_member uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  t_mine uuid;
  t_other uuid;
  v_task_type uuid;
  v_staff_token uuid;
  v_volunteer_token uuid;
  v_person uuid;
  n integer;
  v_hash text;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner);

  -- Tokens made directly (as the database owner) for the read and revoke tests.
  insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
  values (v_org, v_staff, 'Staff tool', repeat('a', 64), 'qbbe_staff01', array['objects:read'], now() + interval '30 days')
  returning id into v_staff_token;
  insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
  values (v_org, v_volunteer, 'Volunteer tool', repeat('b', 64), 'qbbe_volun01', array['objects:read', 'actions:run'], now() + interval '30 days')
  returning id into v_volunteer_token;
  insert into public.api_request_log (organization_id, token_id, user_id, method, path, status)
  values (v_org, v_staff_token, v_staff, 'GET', '/api/v1/me', 200),
         (v_org, v_volunteer_token, v_volunteer, 'GET', '/api/v1/objects', 200);

  -- Constraints.
  begin
    insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
    values (v_org, v_staff, 'Forever', repeat('c', 64), 'qbbe_forev01', array['objects:read'], now() + interval '2 years');
    raise exception 'FAIL: a token for two years was accepted';
  exception when check_violation then
    perform tests.ok(true, 'a token lives at most a year');
  end;
  begin
    insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
    values (v_org, v_staff, 'Admin', repeat('d', 64), 'qbbe_admin01', array['admin:all'], now() + interval '1 day');
    raise exception 'FAIL: an unknown scope was accepted';
  exception when check_violation then
    perform tests.ok(true, 'scopes are a closed list');
  end;
  begin
    insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
    values (v_org, v_staff, 'Plain', 'not-a-hash', 'qbbe_plain01', array['objects:read'], now() + interval '1 day');
    raise exception 'FAIL: a token that is not a hash was stored';
  exception when check_violation then
    perform tests.ok(true, 'only a SHA-256 hash is stored');
  end;

  -- Reading tokens and the log: your own; owners and admins all.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    select count(*) into n from public.api_token where id in (v_staff_token, v_volunteer_token);
    perform tests.ok(n = 2, format('%s (owner or admin) reads every token', v_person));
    select count(*) into n from public.api_request_log where token_id in (v_staff_token, v_volunteer_token);
    perform tests.ok(n = 2, format('%s (owner or admin) reads every call', v_person));
    reset role;
  end loop;
  perform tests.authenticate(v_staff);
  select count(*) into n from public.api_token where id in (v_staff_token, v_volunteer_token);
  perform tests.ok(n = 1, 'staff read only their own token');
  select count(*) into n from public.api_request_log where token_id in (v_staff_token, v_volunteer_token);
  perform tests.ok(n = 1, 'staff read only their own calls');
  select count(*) into n from public.api_token where user_id <> v_staff;
  perform tests.ok(n = 0, 'staff read no one else''s token at all');
  reset role;
  foreach v_person in array array[v_member, v_accountant] loop
    perform tests.authenticate(v_person);
    select count(*) into n from public.api_token where user_id <> v_person;
    perform tests.ok(n = 0, format('%s (member or accountant) reads no one else''s tokens', v_person));
    select count(*) into n from public.api_request_log where user_id is distinct from v_person;
    perform tests.ok(n = 0, format('%s reads no one else''s calls', v_person));
    reset role;
  end loop;

  -- Making tokens: only for yourself.
  foreach v_person in array array[v_owner, v_admin, v_staff, v_member, v_volunteer, v_accountant] loop
    perform tests.authenticate(v_person);
    v_hash := encode(extensions.digest(v_person::text, 'sha256'), 'hex');
    insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
    values (v_org, v_person, 'Mine', v_hash, 'qbbe_mine0001', array['objects:read'], now() + interval '10 days');
    get diagnostics n = row_count;
    perform tests.ok(n = 1, format('%s makes a token for themselves', v_person));
    begin
      insert into public.api_token (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at)
      values (v_org, case when v_person = v_staff then v_owner else v_staff end, 'Theirs', repeat('e', 64),
              'qbbe_theirs01', array['actions:run'], now() + interval '10 days');
      raise exception 'FAIL: % made a token for someone else', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot make a token for someone else', v_person));
    end;
    update public.api_token set scopes = array['objects:read', 'actions:run'] where id = v_staff_token;
    get diagnostics n = row_count;
    perform tests.ok(n = 0, format('%s cannot widen a token''s scopes', v_person));
    begin
      insert into public.api_request_log (organization_id, method, path, status) values (v_org, 'GET', '/forged', 200);
      raise exception 'FAIL: % wrote to the call log', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot write the call log', v_person));
    end;
    reset role;
  end loop;

  -- Revoking: your own, or any as owner or admin.
  foreach v_person in array array[v_member, v_accountant, v_volunteer] loop
    perform tests.authenticate(v_person);
    begin
      perform public.revoke_api_token(v_staff_token);
      raise exception 'FAIL: % revoked someone else''s token', v_person;
    exception when insufficient_privilege then
      perform tests.ok(true, format('%s cannot revoke someone else''s token', v_person));
    end;
    reset role;
  end loop;
  perform tests.authenticate(v_staff);
  perform public.revoke_api_token(v_staff_token);
  perform tests.ok((select revoked_at is not null and revoked_by = v_staff from public.api_token where id = v_staff_token),
    'a person revokes their own token');
  reset role;
  perform tests.authenticate(v_admin);
  perform public.revoke_api_token(v_volunteer_token);
  perform tests.ok((select revoked_at is not null from public.api_token where id = v_volunteer_token),
    'an admin revokes anyone''s token in the organization');
  reset role;
  perform tests.authenticate(v_admin, 'aal1');
  begin
    perform public.revoke_api_token(v_staff_token);
    raise exception 'FAIL: an admin at aal1 revoked someone else''s token';
  exception when insufficient_privilege then
    perform tests.ok(true, 'an admin without the two-step sign-in cannot revoke someone else''s token');
  end;
  reset role;

  -- Signed out: nothing.
  perform tests.clear_auth();
  select count(*) into n from public.api_token;
  perform tests.ok(n = 0, 'a signed-out visitor reads no tokens');
  begin
    perform public.revoke_api_token(v_staff_token);
    raise exception 'FAIL: a signed-out visitor revoked a token';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out visitor cannot revoke a token');
  end;
  reset role;

  -- Objects, listed as the token's person.
  perform tests.ok(
    not has_function_privilege('authenticated', 'public.api_list_objects(uuid, uuid, text, integer, timestamp with time zone, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.api_list_objects(uuid, uuid, text, integer, timestamp with time zone, uuid)', 'execute')
      and has_function_privilege('service_role', 'public.api_list_objects(uuid, uuid, text, integer, timestamp with time zone, uuid)', 'execute'),
    'only the service role lists objects on someone''s behalf'
  );
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'API', 'api-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'API', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'The volunteer''s', v_owner, v_volunteer) returning id into t_mine;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Not the volunteer''s', v_owner) returning id into t_other;
  select id into strict v_task_type from public.object_type where organization_id = v_org and key = 'task';
  insert into public.object (id, organization_id, type_id, title)
  values (t_mine, v_org, v_task_type, 'The volunteer''s'), (t_other, v_org, v_task_type, 'Not the volunteer''s')
  on conflict (id) do nothing;

  select count(*) into n from app.api_list_objects(v_volunteer, v_org, 'task', 100) o where o.id in (t_mine, t_other);
  perform tests.ok(n = 1, 'the volunteer''s token lists only the task they may view');
  select count(*) into n from app.api_list_objects(v_owner, v_org, 'task', 100) o where o.id in (t_mine, t_other);
  perform tests.ok(n = 2, 'the owner''s token lists both');
  select count(*) into n from app.api_list_objects(v_volunteer, v_org, 'project', 100) o where o.id in (t_mine, t_other);
  perform tests.ok(n = 0, 'the type filter applies');
  select count(*) into n from app.api_list_objects(v_owner, gen_random_uuid(), null, 100);
  perform tests.ok(n = 0, 'another organization lists nothing');
  select count(*) into n from app.api_list_objects(v_owner, v_org, 'task', 1);
  perform tests.ok(n = 1, 'the page size applies');
end;
$$;

rollback;
