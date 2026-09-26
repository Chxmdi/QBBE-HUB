-- my_open_task_count() must equal the count the sidebar used to make through
-- row-level security (#115, migration 20260926070000), for every member, and
-- must drop to zero when the member is deactivated. Run after qa-users.sql and
-- rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_user record;
  v_fn bigint;
  v_rls bigint;
  v_people integer := 0;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = v_volunteer;

  -- Every status, archived and not, assigned to the volunteer and the owner.
  insert into public.task (organization_id, title, created_by, assignee_id, status, archived_at, blocked_reason)
  select v_org, 'count: ' || st.status || ' ' || a.archived, v_owner, u.id,
         st.status::public.task_status,
         case when a.archived then now() end,
         case when st.status = 'blocked' then 'Waiting' end
  from unnest(array['not_started', 'ready', 'in_progress', 'waiting', 'blocked',
                    'in_review', 'completed', 'cancelled']) as st(status)
  cross join (values (false), (true)) as a(archived)
  cross join (values (v_volunteer), (v_owner)) as u(id);

  for v_user in select distinct user_id from public.organization_membership loop
    perform tests.authenticate(v_user.user_id, 'aal1');
    select public.my_open_task_count() into v_fn;
    select count(*) into v_rls from public.task
    where assignee_id = v_user.user_id
      and status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
      and archived_at is null;
    perform tests.ok(v_fn = v_rls,
      format('my_open_task_count matches row-level security for %s (%s/%s)',
             v_user.user_id, v_fn, v_rls));
    perform tests.clear_auth();
    v_people := v_people + 1;
  end loop;
  perform tests.ok(v_people >= 5, format('compared %s people', v_people));

  perform tests.authenticate(v_volunteer, 'aal1');
  select public.my_open_task_count() into v_fn;
  perform tests.ok(v_fn >= 6, format('the volunteer counts their open tasks (%s)', v_fn));
  perform tests.clear_auth();

  -- A deactivated member reads none of the organization's tasks, so counts none.
  -- clear_auth leaves the anon role in place, which may not change memberships,
  -- so the update runs as the session's own role.
  reset role;
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = v_volunteer;
  perform tests.authenticate(v_volunteer, 'aal1');
  select public.my_open_task_count() into v_fn;
  select count(*) into v_rls from public.task
  where assignee_id = v_volunteer
    and status::text in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
    and archived_at is null;
  perform tests.ok(v_fn = v_rls and v_fn = 0,
    format('a deactivated member counts nothing (%s/%s)', v_fn, v_rls));
  perform tests.clear_auth();
end
$$;

rollback;
