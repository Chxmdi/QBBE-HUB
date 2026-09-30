-- Workspace OS M3a: relation types, object_relation and the
-- object_relation_all view (20261101010500_object_relations.sql). Allow and
-- deny for owner, admin, staff, volunteer, guest, the external accountant and
-- signed-out. Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

create or replace function tests.relations_raises(p_sql text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end;
$$;
grant execute on function tests.relations_raises(text) to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_task_a uuid;
  v_task_b uuid;
  v_task_c uuid;
  v_task_private uuid;
  v_contact uuid;
  v_meeting uuid;
  v_decision uuid;
  v_related uuid;
  v_contains uuid;
  v_owns uuid;
  v_one_to_one uuid;
  v_person uuid;
  v_count integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'guest', status = 'active'
  where organization_id = v_org and user_id = v_accountant;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_accountant, now() + interval '30 days', v_owner)
  on conflict do nothing;

  select id into v_related from public.relation_type where organization_id = v_org and key = 'related_to';
  select id into v_contains from public.relation_type where organization_id = v_org and key = 'contains';
  select id into v_owns from public.relation_type where organization_id = v_org and key = 'owns';

  perform tests.ok(
    (select count(*) from public.relation_type where organization_id = v_org) = 8
      and (select bool_and(reverse_name_fr <> '') from public.relation_type),
    'the eight relation types are seeded, named both ways in both languages'
  );

  -- Fixtures: the volunteer is assigned tasks A and B, not C or the private one.
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Relations', 'relations-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Relations project', v_owner, v_owner)
  returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Task A', v_owner, v_volunteer) returning id into v_task_a;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Task B', v_owner, v_volunteer) returning id into v_task_b;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Task C', v_owner) returning id into v_task_c;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Private task', v_owner) returning id into v_task_private;
  insert into public.task_dependency (blocking_task_id, blocked_task_id) values (v_task_a, v_task_b);
  insert into public.crm_contact (organization_id, full_name, owner_id)
  values (v_org, 'Linked contact', v_staff) returning id into v_contact;
  insert into public.crm_link (organization_id, contact_id, project_id) values (v_org, v_contact, v_project);
  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at)
  values (v_org, v_project, 'Kick-off', v_owner, now()) returning id into v_meeting;
  insert into public.decision (organization_id, project_id, meeting_id, title)
  values (v_org, v_project, v_meeting, 'Go ahead') returning id into v_decision;

  -- The view shows every native link, as the database owner sees it.
  perform tests.ok(
    exists (select 1 from public.object_relation_all where source = 'task_project'
      and relation_type_key = 'contains' and from_id = v_project and to_id = v_task_a),
    'task.project_id appears as project contains task'
  );
  perform tests.ok(
    exists (select 1 from public.object_relation_all where source = 'task_dependency'
      and relation_type_key = 'blocks' and from_id = v_task_a and to_id = v_task_b),
    'task_dependency appears as blocks'
  );
  perform tests.ok(
    exists (select 1 from public.object_relation_all where source = 'crm_link'
      and relation_type_key = 'related_to' and from_id = v_contact and to_id = v_project and to_type = 'project'),
    'crm_link appears as contact related to project'
  );
  perform tests.ok(
    exists (select 1 from public.object_relation_all where relation_type_key = 'decided_in'
      and from_id = v_decision and to_id = v_meeting)
      and exists (select 1 from public.object_relation_all where relation_type_key = 'contains'
      and from_id = v_project and to_id = v_meeting and to_type = 'meeting'),
    'decision.meeting_id and meeting.project_id appear as relations'
  );
  perform tests.ok(
    (select count(*) from public.object_relation_all where source = 'task_project')
      = (select count(*) from public.task where project_id is not null),
    'one contains row per task with a project, no more'
  );

  -- Writing stored links.
  perform tests.ok(
    tests.relations_raises(format(
      'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
      v_org, v_project, v_task_c, v_contains)),
    'a native relation type cannot be written into object_relation'
  );
  perform tests.ok(
    tests.relations_raises(format(
      'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
      v_org, v_task_a, v_task_a, v_related)),
    'an object cannot be related to itself'
  );

  -- Cardinality: "owns" is one-to-many, so a thing has one owner.
  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id)
  values (v_org, v_task_a, v_task_c, v_owns);
  perform tests.ok(
    tests.relations_raises(format(
      'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
      v_org, v_task_b, v_task_c, v_owns)),
    'one-to-many: the "to" end cannot have a second link of that type'
  );
  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id)
  values (v_org, v_task_a, v_task_private, v_owns);
  perform tests.ok(
    (select count(*) from public.object_relation where from_id = v_task_a and relation_type_id = v_owns) = 2,
    'one-to-many: the "from" end can have many'
  );
  insert into public.relation_type (organization_id, key, name_en, name_fr, reverse_name_en, reverse_name_fr, cardinality)
  values (v_org, 'pairs_with', 'Pairs with', 'Jumelé à', 'Paired with', 'Jumelé avec', 'one_to_one')
  returning id into v_one_to_one;
  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id)
  values (v_org, v_task_b, v_task_c, v_one_to_one);
  perform tests.ok(
    tests.relations_raises(format(
      'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
      v_org, v_task_b, v_task_private, v_one_to_one)),
    'one-to-one: the "from" end cannot have a second link either'
  );
  perform tests.ok(
    exists (select 1 from public.object_relation_all where source = 'object_relation'
      and relation_type_key = 'owns' and from_id = v_task_a and to_id = v_task_c
      and from_type = 'task' and to_type = 'task'),
    'stored links appear in the view with both ends'' types'
  );

  -- Relation types: owners and admins add custom ones; nobody adds native ones.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      not tests.relations_raises(format(
        'insert into public.relation_type (organization_id, key, name_en, name_fr, reverse_name_en, reverse_name_fr) values (%L, %L, ''Funds'', ''Finance'', ''Funded by'', ''Financé par'')',
        v_org, 'funds_' || substr(md5(v_person::text), 1, 6)))
      and tests.relations_raises(format(
        'insert into public.relation_type (organization_id, key, name_en, name_fr, reverse_name_en, reverse_name_fr, is_native) values (%L, ''fake_native'', ''X'', ''X'', ''X'', ''X'', true)',
        v_org)),
      format('%s adds a custom relation type but not a native one', v_person)
    );
    reset role;
  end loop;
  foreach v_person in array array[v_staff, v_volunteer, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    perform tests.ok(
      tests.relations_raises(format(
        'insert into public.relation_type (organization_id, key, name_en, name_fr, reverse_name_en, reverse_name_fr) values (%L, %L, ''X'', ''X'', ''X'', ''X'')',
        v_org, 'denied_' || substr(md5(v_person::text), 1, 6)))
      and (select count(*) from public.relation_type where organization_id = v_org) >= 8,
      format('%s reads relation types but cannot add one', v_person)
    );
    reset role;
  end loop;

  -- Reading links: view on both ends.
  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.object_relation where from_id = v_task_a;
    perform tests.ok(v_count = 2, format('%s reads every stored link', v_person));
    reset role;
  end loop;

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    not exists (select 1 from public.object_relation where to_id in (v_task_c, v_task_private)),
    'the volunteer does not read links to tasks they cannot see'
  );
  perform tests.ok(
    exists (select 1 from public.object_relation_all where relation_type_key = 'blocks'
      and from_id = v_task_a and to_id = v_task_b)
      and not exists (select 1 from public.object_relation_all where to_id = v_task_c),
    'through the view, the volunteer sees the dependency between their tasks and nothing about task C'
  );
  -- Writing: edit_content on both ends.
  perform tests.ok(
    not tests.relations_raises(format(
      'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
      v_org, v_task_a, v_task_b, v_related)),
    'the volunteer links two tasks they can both edit'
  );
  perform tests.ok(
    tests.relations_raises(format(
      'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
      v_org, v_task_a, v_task_private, v_related)),
    'the volunteer cannot link to a task they cannot edit'
  );
  delete from public.object_relation where from_id = v_task_a and to_id = v_task_c;
  reset role;
  perform tests.ok(
    exists (select 1 from public.object_relation where from_id = v_task_a and to_id = v_task_c),
    'the volunteer cannot delete a link whose other end they cannot edit'
  );

  foreach v_person in array array[v_staff, v_guest, v_accountant] loop
    perform tests.authenticate(v_person);
    select count(*) into v_count from public.object_relation where from_id = v_task_a and to_id = v_task_c;
    perform tests.ok(
      (v_count = 1) = (public.can(v_task_a, 'view') and public.can(v_task_c, 'view')),
      format('%s reads a stored link exactly when they can view both ends', v_person)
    );
    if not (public.can(v_task_a, 'edit_content') and public.can(v_task_private, 'edit_content')) then
      perform tests.ok(
        tests.relations_raises(format(
          'insert into public.object_relation (organization_id, from_id, to_id, relation_type_id) values (%L, %L, %L, %L)',
          v_org, v_task_a, v_task_private, v_related)),
        format('%s cannot link tasks they cannot edit', v_person)
      );
    end if;
    reset role;
  end loop;

  perform tests.authenticate(v_guest);
  perform tests.ok(
    not exists (select 1 from public.object_relation_all where from_id = v_project or to_id = v_project),
    'a guest with no grant sees no links to or from the project'
  );
  reset role;

  -- Links go with their objects.
  delete from public.task where id = v_task_c;
  perform tests.ok(
    not exists (select 1 from public.object_relation where to_id = v_task_c or from_id = v_task_c),
    'deleting a task deletes its stored links'
  );
end;
$$;

do $$
begin
  perform tests.clear_auth();
  perform tests.ok(
    tests.relations_raises('select 1 from public.object_relation limit 1')
      and tests.relations_raises('select 1 from public.object_relation_all limit 1')
      and tests.relations_raises('select 1 from public.relation_type limit 1'),
    'a signed-out visitor cannot read relations'
  );
  reset role;
end;
$$;

rollback;
