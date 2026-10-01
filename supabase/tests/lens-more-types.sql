-- Workspace OS integration I2: every registered type through the lens engine.
-- Run after qa-users.sql, rls.sql and lens-query-engine.sql. Rolled back.
--
-- What must hold (migration 20261107020100):
--   1. For decision, meeting, milestone, document, activity and risk, the rows
--      a lens returns are exactly the rows RLS lets each fixture person select
--      directly, and the counts agree. Archived documents never appear.
--   2. The living project page's blocks give the same rows, in the same order,
--      through the engine as through the readers they replace (the task
--      stand-in and the project page's own NATIVE_TYPES table). The lens specs
--      here are the ones src/features/project-page/blocks.ts compiles to
--      (pinned in src/features/project-page/tests/project-page.test.ts).
--   3. A viewer who cannot read the project finds none of its blocks' rows by
--      its id (the hidden-reference rule holds for the new types too).
--   4. A uuid shown as text (activity.source_id) can be filtered as text.
--   5. A relation filter into a type without an archive column compiles and
--      runs; one into a type with an archive column still excludes archived.
begin;

create function pg_temp.today() returns date language sql stable
  as $$ select (now() at time zone 'America/Toronto')::date $$;

create temporary table lens_mt (name text primary key, id uuid) on commit drop;
grant select on lens_mt to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_meeting uuid;
  v_task uuid;
  v_decision uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'More types program', 'more-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by, stage, outcome, target_date)
  values (v_org, v_program, 'More types project', v_owner, v_owner, 'active', 'An outcome', pg_temp.today() + 30)
  returning id into v_project;
  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at, status)
  values (v_org, v_project, 'More types meeting', v_owner, now() + interval '2 days', 'scheduled')
  returning id into v_meeting;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id, status, due_at)
  values (v_org, v_project, 'More types task', v_owner, v_staff, 'in_progress', pg_temp.today() + 3)
  returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by, status)
  values (v_org, v_project, 'More types done task', v_owner, 'completed');
  insert into public.decision (organization_id, project_id, meeting_id, title, decided_by, decided_at)
  values (v_org, v_project, v_meeting, 'More types meeting decision', v_owner, now() - interval '1 day')
  returning id into v_decision;
  insert into public.decision (organization_id, project_id, title, decided_by, decided_at)
  values (v_org, v_project, 'More types staff decision', v_owner, now() - interval '2 days');
  insert into public.milestone (project_id, name, due_date, status) values
    (v_project, 'More types milestone late', pg_temp.today() - 1, 'planned'),
    (v_project, 'More types milestone next', pg_temp.today() + 10, 'in_progress'),
    (v_project, 'More types milestone open', null, 'planned');
  insert into public.document (organization_id, project_id, title, kind, url, visibility, created_by)
  values (v_org, v_project, 'More types link', 'link', 'https://drive.google.com/file/d/mt-a/view', 'organization', v_owner),
         (v_org, v_project, 'More types staff link', 'link', 'https://drive.google.com/file/d/mt-b/view', 'staff', v_owner);
  insert into public.document (organization_id, project_id, title, kind, url, visibility, created_by, archived_at)
  values (v_org, v_project, 'More types archived link', 'link', 'https://drive.google.com/file/d/mt-c/view', 'organization', v_owner, now());
  insert into public.risk (organization_id, project_id, title, likelihood, impact, status, created_by, mitigation) values
    (v_org, v_project, 'More types risk high', 'high', 'high', 'open', v_owner, null),
    (v_org, v_project, 'More types risk low', 'low', 'medium', 'mitigating', v_owner, null),
    (v_org, v_project, 'More types risk closed', 'high', 'high', 'closed', v_owner, 'Handled');
  insert into public.activity_event (organization_id, actor_id, verb, source_type, source_id, project_id, summary) values
    (v_org, v_owner, 'created', 'task', v_task, v_project, 'More types task created'),
    (v_org, v_owner, 'created', 'decision', v_decision, v_project, 'More types decision made');
  insert into lens_mt values ('org', v_org), ('project', v_project), ('meeting', v_meeting), ('task', v_task), ('decision', v_decision);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Every person sees through each new lens exactly what RLS shows them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_person uuid;
  v_people uuid[];
  v_type text;
  v_result jsonb;
  v_lens uuid[];
  v_direct uuid[];
  v_checked integer := 0;
begin
  select array_agg(user_id) into v_people
  from public.organization_membership where organization_id = (select id from lens_mt where name = 'org');

  foreach v_person in array v_people loop
    perform tests.authenticate(v_person, 'aal2');
    foreach v_type in array array['decision', 'meeting', 'milestone', 'document', 'activity', 'risk'] loop
      v_result := public.lens_query(jsonb_build_object('version', 1, 'type', v_type, 'limit', 1000,
        'select', jsonb_build_array('project')));
      select coalesce(array_agg((r ->> 'id')::uuid order by (r ->> 'id')), array[]::uuid[])
      into v_lens from jsonb_array_elements(v_result -> 'rows') r;
      v_direct := case v_type
        when 'decision' then (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.decision)
        when 'meeting' then (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.meeting)
        when 'milestone' then (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.milestone)
        when 'document' then (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.document where archived_at is null)
        when 'activity' then (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.activity_event)
        else (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.risk)
      end;
      perform tests.ok(v_lens = v_direct, format('%s: the %s lens returns exactly the rows RLS allows', v_person, v_type));
      perform tests.ok((v_result ->> 'total')::int = cardinality(v_direct), format('%s: the %s count matches RLS', v_person, v_type));
      v_checked := v_checked + 1;
    end loop;
    reset role;
  end loop;
  perform tests.ok(v_checked >= 6, 'the RLS comparison ran for every new type');

  -- The archived document is never listed, not even for its owner.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  v_result := public.lens_query('{"version":1,"type":"document","where":{"and":[{"property":"title","operator":"contains","value":"More types archived"}]}}');
  perform tests.ok((v_result ->> 'total')::int = 0, 'an archived document is left out of the lens');
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 and 3. The project page's blocks: engine rows equal the old readers' rows.
-- ---------------------------------------------------------------------------
create function pg_temp.lens_ids(p_spec jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((r.value ->> 'id')::uuid order by r.ordinality), array[]::uuid[])
  from jsonb_array_elements(public.lens_query(p_spec) -> 'rows') with ordinality r;
$$;

do $$
declare
  v_person uuid;
  v_people uuid[];
  v_p uuid := (select id from lens_mt where name = 'project');
  v_in_project jsonb;
  v_can_read boolean;
  v_specs jsonb;
  v_block text;
  v_old uuid[];
  v_new uuid[];
  v_compared integer := 0;
begin
  v_in_project := jsonb_build_object('property', 'project', 'operator', 'contains', 'value', v_p);
  v_specs := jsonb_build_object(
    'openTasks', jsonb_build_object('version', 1, 'type', 'task',
      'where', jsonb_build_object('and', jsonb_build_array(v_in_project,
        jsonb_build_object('property', 'status', 'operator', 'is_any_of', 'value', '["not_started","ready","in_progress","waiting","blocked","in_review"]'::jsonb))),
      'sort', '[{"property":"due","direction":"asc"}]'::jsonb, 'select', '["status","due","assignee","priority"]'::jsonb, 'limit', 10, 'offset', 0),
    'decisions', jsonb_build_object('version', 1, 'type', 'decision',
      'where', jsonb_build_object('and', jsonb_build_array(v_in_project)),
      'sort', '[{"property":"decided_time","direction":"desc"}]'::jsonb, 'select', '["decided_time","meeting","project"]'::jsonb, 'limit', 5, 'offset', 0),
    'milestones', jsonb_build_object('version', 1, 'type', 'milestone',
      'where', jsonb_build_object('and', jsonb_build_array(v_in_project)),
      'sort', '[{"property":"due","direction":"asc"}]'::jsonb, 'select', '["due","status","completed_time","project"]'::jsonb, 'limit', 10, 'offset', 0),
    'files', jsonb_build_object('version', 1, 'type', 'document',
      'where', jsonb_build_object('and', jsonb_build_array(v_in_project)),
      'sort', '[{"property":"edited_time","direction":"desc"}]'::jsonb, 'select', '["edited_time","kind"]'::jsonb, 'limit', 8, 'offset', 0),
    'activity', jsonb_build_object('version', 1, 'type', 'activity',
      'where', jsonb_build_object('and', jsonb_build_array(v_in_project)),
      'sort', '[{"property":"created_time","direction":"desc"}]'::jsonb, 'select', '["created_time","source_type","source_id","project"]'::jsonb, 'limit', 10, 'offset', 0),
    'risks', jsonb_build_object('version', 1, 'type', 'risk',
      'where', jsonb_build_object('and', jsonb_build_array(v_in_project,
        jsonb_build_object('property', 'status', 'operator', 'is_any_of', 'value', '["open","mitigating"]'::jsonb))),
      'sort', '[{"property":"score","direction":"desc"}]'::jsonb, 'select', '["status","likelihood","impact","score","project"]'::jsonb, 'limit', 8, 'offset', 0));

  select array_agg(user_id) into v_people
  from public.organization_membership where organization_id = (select id from lens_mt where name = 'org');

  foreach v_person in array v_people loop
    perform tests.authenticate(v_person, 'aal2');
    v_can_read := exists (select 1 from public.project where id = v_p);
    for v_block in select * from jsonb_object_keys(v_specs) loop
      v_new := pg_temp.lens_ids(v_specs -> v_block);
      if not v_can_read then
        -- The page itself answers "not found" to this person; the engine finds nothing by the hidden project's id.
        perform tests.ok(cardinality(v_new) = 0, format('%s: no %s rows for a project they cannot read', v_person, v_block));
        continue;
      end if;
      -- What the old reader produced: the same filter, sort and limit through PostgREST (nulls last, id as the tiebreaker).
      v_old := case v_block
        when 'openTasks' then (select coalesce(array_agg(id order by due_at asc nulls last, id), array[]::uuid[]) from (
          select id, due_at from public.task where project_id = v_p and archived_at is null
            and status in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review')
          order by due_at asc nulls last, id limit 10) s)
        when 'decisions' then (select coalesce(array_agg(id order by decided_at desc nulls last, id), array[]::uuid[]) from (
          select id, decided_at from public.decision where project_id = v_p order by decided_at desc nulls last, id limit 5) s)
        when 'milestones' then (select coalesce(array_agg(id order by due_date asc nulls last, id), array[]::uuid[]) from (
          select id, due_date from public.milestone where project_id = v_p order by due_date asc nulls last, id limit 10) s)
        when 'files' then (select coalesce(array_agg(id order by updated_at desc nulls last, id), array[]::uuid[]) from (
          select id, updated_at from public.document where project_id = v_p and archived_at is null order by updated_at desc nulls last, id limit 8) s)
        when 'activity' then (select coalesce(array_agg(id order by created_at desc nulls last, id), array[]::uuid[]) from (
          select id, created_at from public.activity_event where project_id = v_p order by created_at desc nulls last, id limit 10) s)
        else (select coalesce(array_agg(id order by score desc nulls last, id), array[]::uuid[]) from (
          select id, score from public.risk where project_id = v_p and status in ('open', 'mitigating') order by score desc nulls last, id limit 8) s)
      end;
      perform tests.ok(v_new = v_old, format('%s: the %s block gives the same rows in the same order through the engine', v_person, v_block));
      v_compared := v_compared + 1;
    end loop;
    reset role;
  end loop;
  perform tests.ok(v_compared >= 6, 'at least one person compared every block');

  -- Spot checks on the owner's rows: the fixture data is really there.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  perform tests.ok(cardinality(pg_temp.lens_ids(v_specs -> 'decisions')) = 2, 'the owner sees both decisions');
  perform tests.ok(cardinality(pg_temp.lens_ids(v_specs -> 'milestones')) = 3, 'the owner sees three milestones');
  perform tests.ok(cardinality(pg_temp.lens_ids(v_specs -> 'files')) = 2, 'the owner sees the two unarchived files');
  perform tests.ok(cardinality(pg_temp.lens_ids(v_specs -> 'risks')) = 2, 'the owner sees the two open risks');
  perform tests.ok(cardinality(pg_temp.lens_ids(v_specs -> 'activity')) = 2, 'the owner sees both activity rows');
  perform tests.ok(cardinality(pg_temp.lens_ids(v_specs -> 'openTasks')) = 1, 'the owner sees the one open task');
  perform tests.ok((pg_temp.lens_ids(v_specs -> 'milestones'))[1] = (select id from public.milestone where name = 'More types milestone late'),
    'milestones come earliest first, the undated one last');
  perform tests.ok((pg_temp.lens_ids(v_specs -> 'risks'))[1] = (select id from public.risk where title = 'More types risk high'),
    'risks come highest score first');
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4 and 5. The two builder additions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_task uuid := (select id from lens_mt where name = 'task');
  v_sql text;
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');

  -- A uuid shown as text: shown as the id, filtered by equals and contains.
  v_result := public.lens_query(jsonb_build_object('version', 1, 'type', 'activity', 'select', '["source_id","source_type"]'::jsonb,
    'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object('property', 'source_id', 'operator', 'equals', 'value', v_task::text)))));
  perform tests.ok((v_result ->> 'total')::int = 1 and v_result #>> '{rows,0,values,source_id}' = v_task::text
    and v_result #>> '{rows,0,values,source_type}' = 'task',
    'activity can be found by its source id and shows it');
  v_result := public.lens_query(jsonb_build_object('version', 1, 'type', 'activity',
    'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object('property', 'source_id', 'operator', 'contains', 'value', substr(v_task::text, 1, 8))))));
  perform tests.ok((v_result ->> 'total')::int = 1, 'contains works on a uuid shown as text');
  v_result := public.lens_query('{"version":1,"type":"activity","where":{"and":[{"property":"source_id","operator":"is_empty"}]}}');
  perform tests.ok((v_result ->> 'total')::int = 0, 'is_empty works on a uuid shown as text');

  -- A relation into a type without an archive column (document -> meeting).
  v_result := public.lens_query('{"version":1,"type":"decision","where":{"and":[{"property":"meeting","operator":"matches","value":{"where":{"and":[{"property":"status","operator":"is","value":"scheduled"}]}}}]}}');
  perform tests.ok((v_result ->> 'total')::int = 1 and v_result #>> '{rows,0,title}' = 'More types meeting decision',
    'a relation filter into a type without an archive column runs');
  v_sql := public.lens_compile('{"version":1,"type":"decision","where":{"and":[{"property":"meeting","operator":"matches","value":{"where":{"and":[{"property":"status","operator":"is","value":"scheduled"}]}}}]}}') #>> '{page,sql}';
  perform tests.ok(v_sql not like '%t1.archived_at%' and v_sql like '%where true and%',
    'the meeting subquery has no archive condition');
  v_sql := public.lens_compile('{"version":1,"type":"decision","where":{"and":[{"property":"project","operator":"matches","value":{"where":{"and":[{"property":"stage","operator":"is","value":"active"}]}}}]}}') #>> '{page,sql}';
  perform tests.ok(v_sql like '%t1.archived_at is null%', 'the project subquery still excludes archived projects');
  v_sql := public.lens_compile('{"version":1,"type":"milestone"}') #>> '{page,sql}';
  perform tests.ok(v_sql like '%from public.milestone o where true and%', 'a type without an archive column lists every row');
  v_sql := public.lens_compile('{"version":1,"type":"document"}') #>> '{page,sql}';
  perform tests.ok(v_sql like '%from public.document o where o.archived_at is null and%', 'a type with an archive column still hides archived rows');

  -- Hidden references on the new types: a decision whose meeting the viewer cannot read shows no meeting.
  reset role;
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aal2');
  if not exists (select 1 from public.meeting where id = (select id from lens_mt where name = 'meeting')) then
    v_result := public.lens_query(jsonb_build_object('version', 1, 'type', 'decision', 'select', '["meeting"]'::jsonb,
      'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object('property', 'title', 'operator', 'equals', 'value', 'More types meeting decision')))));
    perform tests.ok((v_result ->> 'total')::int = 0 or v_result #> '{rows,0,values,meeting}' = 'null'::jsonb,
      'the volunteer never sees a meeting they cannot read through a decision');
  else
    perform tests.ok(true, 'the volunteer can read the fixture meeting; the hidden-meeting check does not apply');
  end if;
  reset role;
end;
$$;

rollback;
