-- A task contributor (the assignee, for example) cannot make themselves the
-- approver, or finish a task that waits for someone else's approval.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  volunteer_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  org uuid;
  v_project uuid;
  v_task uuid;
  v_other uuid;
  refused boolean;
  n int;
  col text;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (org, 'TAF project', owner_user, owner_user) returning id into v_project;
  insert into public.task (organization_id, project_id, title, assignee_id, approver_id, status, created_by)
  values (org, v_project, 'TAF task', volunteer_user, owner_user, 'in_review', owner_user) returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by)
  values (org, v_project, 'TAF other', owner_user) returning id into v_other;

  perform tests.authenticate(volunteer_user, 'aal1');
  set local role authenticated;
  perform tests.ok(public.has_task_capability(v_task, 'collaborate') and not public.has_task_capability(v_task, 'approve'),
    'the assignee collaborates on the task but does not approve it');

  refused := false;
  begin
    update public.task set status = 'completed' where id = v_task;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'the assignee cannot complete a task that waits for its approver');

  foreach col in array array['approver_id', 'blocked_by_id', 'series_id'] loop
    refused := false;
    begin
      execute format('update public.task set %I = %s where id = %L', col,
        case col when 'approver_id' then quote_literal(volunteer_user)
                 when 'blocked_by_id' then quote_literal(v_other)
                 when 'series_id' then quote_literal(gen_random_uuid())
                 else quote_literal('meeting') end,
        v_task);
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('the assignee cannot change the task''s %s', col));
  end loop;

  update public.task set description = 'TAF notes' where id = v_task;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the assignee can still edit the task''s description');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
