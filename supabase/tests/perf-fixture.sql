-- 50-user performance fixture (#115, QA-FINAL "50-user performance").
-- Idempotent. Local and CI only; never run against a hosted project.
-- Runs after qa-users.sql (it needs tests.ensure_auth_user and the owner).
--
-- Shape, sized to a busy QBBE year rather than an empty workspace:
--   50 people (qa-perf-01..50@example.com, password QaTest!2026):
--     10 staff, 40 volunteers, every one admitted through an invitation;
--   1 program, 10 projects, each with 5 staff contributors and 8 volunteer
--     contributors, so every person has scoped work;
--   2,000 tasks spread over the projects and assigned across the people;
--   1 public channel everyone is in, with 1,000 messages of history.

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_program uuid;
  v_channel uuid;
  i integer;
begin
  select organization_id into strict v_org
  from organization_membership where user_id = v_owner limit 1;

  if exists (select 1 from program where slug = 'perf-program') then
    raise notice 'Performance fixture already present; nothing to do.';
    return;
  end if;

  insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
  select v_org, format('qa-perf-%s@example.com', lpad(n::text, 2, '0')),
         (case when n <= 10 then 'staff' else 'volunteer' end)::org_role,
         v_owner, now() + interval '30 days'
  from generate_series(1, 50) as n
  where not exists (
    select 1 from auth.users u where u.email = format('qa-perf-%s@example.com', lpad(n::text, 2, '0'))
  );

  for i in 1..50 loop
    perform tests.ensure_auth_user(
      ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(i::text, 12, '0'))::uuid,
      format('qa-perf-%s@example.com', lpad(i::text, 2, '0')),
      format('Perf Person %s', lpad(i::text, 2, '0'))
    );
  end loop;

  update user_profile set onboarded_at = coalesce(onboarded_at, now())
  where id::text like 'bbbbbbbb-bbbb-bbbb-bbbb-%';

  insert into program (organization_id, name, slug, description, lead_id, created_by)
  values (v_org, 'Performance Program', 'perf-program', 'Synthetic load fixture.', v_owner, v_owner)
  returning id into v_program;

  insert into project (organization_id, program_id, name, outcome, owner_id, stage, health, start_date, target_date, created_by)
  select v_org, v_program, format('Perf Project %s', lpad(p::text, 2, '0')),
         'Synthetic project for load measurement.', v_owner, 'active', 'on_track',
         current_date - 30, current_date + 90, v_owner
  from generate_series(1, 10) as p;

  -- Each project: staff 1..10 cycle, volunteers spread so each has work.
  insert into project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  select v_org, pr.id,
         ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(u::text, 12, '0'))::uuid,
         'contributor', 'direct', v_owner
  from project pr
  cross join lateral (select substring(pr.name from '(\d+)$')::int as pr_n) as n
  cross join lateral (
    select ((n.pr_n + k) % 10) + 1 as u from generate_series(0, 4) as k
    union
    select 11 + ((n.pr_n * 4 + k) % 40) as u from generate_series(0, 7) as k
  ) as members
  where pr.program_id = v_program;

  insert into task (organization_id, project_id, title, status, priority, assignee_id, created_by, due_at, sort_key,
                    blocked_reason, completed_at)
  select v_org, pr.id,
         format('Perf task %s', t),
         (array['not_started', 'in_progress', 'blocked', 'completed'])[1 + t % 4]::task_status,
         (array['low', 'medium', 'high', 'critical'])[1 + t % 4]::task_priority,
         g.user_id,
         v_owner,
         now() + ((t % 60) - 20) * interval '1 day',
         t,
         case when t % 4 = 2 then 'Waiting on the venue' end,
         case when t % 4 = 3 then now() - (t % 30) * interval '1 day' end
  from generate_series(1, 2000) as t
  join lateral (
    select id from project where program_id = v_program order by name offset (t % 10) limit 1
  ) as pr on true
  join lateral (
    select user_id from project_access_grant
    where project_id = pr.id and source = 'direct'
    order by user_id offset (t % 13) limit 1
  ) as g on true;

  insert into channel (organization_id, name, slug, type, privacy, owner_id, created_by)
  values (v_org, 'perf-general', 'perf-general', 'custom', 'public', v_owner, v_owner)
  returning id into v_channel;

  insert into channel_member (channel_id, user_id)
  select v_channel, ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0'))::uuid
  from generate_series(1, 50) as n;

  insert into message (organization_id, channel_id, author_id, body, created_at)
  select v_org, v_channel,
         ('bbbbbbbb-bbbb-bbbb-bbbb-' || lpad((1 + m % 50)::text, 12, '0'))::uuid,
         format('Perf message %s about the spring schedule', m),
         now() - (1000 - m) * interval '1 minute'
  from generate_series(1, 1000) as m;

  raise notice 'Performance fixture created: 50 people, 10 projects, 2000 tasks, 1000 messages.';
end
$$;
