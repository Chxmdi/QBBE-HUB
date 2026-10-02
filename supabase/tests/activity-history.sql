-- Wave 2 C2: activity history (20261110030000_activity_history.sql). Run
-- after qa-users.sql and rls.sql; everything is rolled back.
--
-- Fixture people: owner a1, staff a2, volunteer a3, admin a4, guest a5.
--
-- What must hold:
--   C2-1  page, block (added, moved, removed, updated), property, permission
--         and relation changes are recorded as <type>.<verb>, with the actor.
--   C2-3  restoring a version adds version.restored and keeps every entry
--         written before it.
--   C2-4  page visibility and sharing (granted, role changed, revoked) appear.
--   C2-5  nobody reads an entry about an object they cannot open, about a
--         private property they cannot see, or about a relation to a record
--         they cannot open; nobody signed in can write, change or delete one.
begin;

create or replace function tests.activity_raises(p_sql text)
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

-- Rows changed by a statement (0 when RLS hides every row).
create or replace function tests.activity_rows(p_sql text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
exception when others then
  return -1;
end;
$$;

-- Events of an object in order, as the database owner sees them.
create or replace function tests.activity_events(p_object uuid)
returns text[]
language sql
set search_path = ''
as $$
  select coalesce(array_agg(event order by seq), '{}') from public.activity_entry where object_id = p_object;
$$;

grant execute on all functions in schema tests to anon, authenticated;

create or replace function tests.activity_doc(p_blocks jsonb)
returns jsonb
language sql
immutable
as $$ select jsonb_build_object('version', 1, 'blocks', p_blocks); $$;

create or replace function tests.activity_block(p_id text, p_text text, p_children jsonb default '[]'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p_id, 'type', 'paragraph', 'props', '{}'::jsonb,
    'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)), 'children', p_children);
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  p_shared uuid;
  p_parent uuid;
  p_private uuid;
  v_program uuid;
  v_project uuid;
  v_task uuid;
  v_hidden_task uuid;
  v_task_type uuid;
  v_related uuid;
  v_follower uuid;
  v_contributor uuid;
  v_grant uuid;
  p_public_prop uuid;
  p_private_prop uuid;
  v_events text[];
  v_count integer;
  v_before_restore integer;
  v_first uuid;
  v_person uuid;
  v_level text;
  v_role text;
  v_entry public.activity_entry;
  v_many jsonb;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  select id into strict v_task_type from public.object_type where organization_id = v_org and key = 'task';
  select id into strict v_related from public.relation_type where organization_id = v_org and key = 'related_to';
  select id into strict v_follower from public.access_role where builtin and key = 'task_follower';
  select id into strict v_contributor from public.access_role where builtin and key = 'task_contributor';

  -- -------------------------------------------------------------------------
  -- Hardening
  -- -------------------------------------------------------------------------
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and (p.proname like 'activity_from_%' or p.proname in
       ('record_activity', 'activity_actor', 'activity_object_type', 'can_read_activity'))),
    'C2: every activity writer and reader is security definer with an empty search path'
  );
  perform tests.ok(
    not has_function_privilege('authenticated', 'app.record_activity(uuid, uuid, text, text, text, jsonb)', 'execute')
      and not has_function_privilege('anon', 'app.record_activity(uuid, uuid, text, text, text, jsonb)', 'execute'),
    'C2: nobody outside the triggers can call the writer'
  );
  perform tests.ok(
    not has_table_privilege('anon', 'public.activity_entry', 'select')
      and not has_table_privilege('authenticated', 'public.activity_entry', 'insert')
      and not has_table_privilege('authenticated', 'public.activity_entry', 'update')
      and not has_table_privilege('authenticated', 'public.activity_entry', 'delete')
      and has_table_privilege('authenticated', 'public.activity_entry', 'select'),
    'C2: signed-in people can only read activity; signed-out visitors cannot even read'
  );
  perform tests.ok(
    tests.activity_raises(format(
      'insert into public.activity_entry (organization_id, object_id, object_type, event, actor_kind) values (%L, %L, ''page'', ''updated'', ''system'')',
      v_org, gen_random_uuid())),
    'C2-1: an event name that is not <type>.<verb> is refused'
  );

  -- -------------------------------------------------------------------------
  -- C2-1 Pages, by the staff member who writes them
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_staff, 'Volunteer guide') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_staff, 'Guides') returning id into p_parent;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_staff, 'My notes') returning id into p_private;
  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  values (p_shared, 'page', v_org, tests.activity_doc(jsonb_build_array(
    tests.activity_block('a', 'Welcome'), tests.activity_block('b', 'Parking'),
    tests.activity_block('c', 'Kitchen'), tests.activity_block('d', 'Safety'))), 'x', v_staff);
  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  values (p_private, 'page', v_org, tests.activity_doc(jsonb_build_array(tests.activity_block('p', 'Secret'))), 'x', v_staff);

  update public.page set title = 'Volunteer handbook', icon = '📘' where id = p_shared;
  update public.page set parent_page_id = p_parent where id = p_shared;
  reset role;

  v_events := tests.activity_events(p_shared);
  perform tests.ok(v_events = array['page.created', 'page.updated', 'page.moved'],
    format('C2-1: a page records page.created, page.updated and page.moved (got %s)', v_events));
  perform tests.ok(
    (select details -> 'changes' from public.activity_entry where object_id = p_shared and event = 'page.updated')
      = '[{"field": "title", "before": "Volunteer guide", "after": "Volunteer handbook"},
          {"field": "icon", "before": null, "after": "📘"}]'::jsonb,
    'C2-1: page.updated lists each changed field with its before and after'
  );
  perform tests.ok(
    (select bool_and(actor_kind = 'person' and actor_id = v_staff) from public.activity_entry where object_id = p_shared),
    'C2-1: each entry names the signed-in person who acted'
  );
  perform tests.ok(
    (select count(*) from public.activity_entry where object_id = p_shared and event like 'block.%') = 0,
    'C2-1: the first save of a page body adds no block entries (the page is new)'
  );

  -- Blocks: d moved to the top, b removed, e added, a edited (twice: one entry).
  perform tests.authenticate(v_staff, 'aal1');
  update public.editor_document set content = tests.activity_doc(jsonb_build_array(
    tests.activity_block('d', 'Safety'), tests.activity_block('a', 'Welcome!'),
    tests.activity_block('c', 'Kitchen'), tests.activity_block('e', 'First aid')))
  where object_id = p_shared;
  update public.editor_document set content = tests.activity_doc(jsonb_build_array(
    tests.activity_block('d', 'Safety'), tests.activity_block('a', 'Welcome, everyone!'),
    tests.activity_block('c', 'Kitchen'), tests.activity_block('e', 'First aid')))
  where object_id = p_shared;
  reset role;

  perform tests.ok(
    (select array_agg(event || ':' || subject order by event, subject) from public.activity_entry
     where object_id = p_shared and event like 'block.%')
      = array['block.added:e', 'block.moved:d', 'block.removed:b', 'block.updated:a'],
    format('C2-1: one save records block.added, block.moved, block.removed and block.updated (got %s)',
      (select array_agg(event || ':' || subject order by seq) from public.activity_entry
       where object_id = p_shared and event like 'block.%'))
  );
  perform tests.ok(
    (select details ->> 'text' from public.activity_entry where object_id = p_shared and event = 'block.updated')
      = 'Welcome, everyone!',
    'C2-1: typing again in the same block within ten minutes updates its one entry'
  );
  perform tests.ok(
    (select details ->> 'text' from public.activity_entry where object_id = p_shared and event = 'block.removed')
      = 'Parking',
    'C2-1: a removed block keeps its text in the entry'
  );

  -- Nesting a block under another is a move; inserting above others is not.
  select max(seq) into v_count from public.activity_entry where object_id = p_shared;
  update public.editor_document set content = tests.activity_doc(jsonb_build_array(
    tests.activity_block('z', 'Intro'),
    tests.activity_block('d', 'Safety', jsonb_build_array(tests.activity_block('c', 'Kitchen'))),
    tests.activity_block('a', 'Welcome, everyone!'), tests.activity_block('e', 'First aid')))
  where object_id = p_shared;
  perform tests.ok(
    (select array_agg(event || ':' || subject order by seq) from public.activity_entry
     where object_id = p_shared and event like 'block.%' and seq > v_count)
      = array['block.added:z', 'block.moved:c'],
    'C2-1: a block nested under another is moved; blocks pushed down by an insert are not'
  );

  -- A paste of many blocks becomes one entry with a count.
  select jsonb_agg(tests.activity_block('m' || g, 'Line ' || g)) into v_many from generate_series(1, 25) g;
  update public.editor_document set content = tests.activity_doc(
    (select content -> 'blocks' from public.editor_document where object_id = p_shared) || v_many)
  where object_id = p_shared;
  perform tests.ok(
    (select count(*) from public.activity_entry where object_id = p_shared and event = 'block.added'
       and (details ->> 'count')::integer = 25) = 1
      and (select count(*) from public.activity_entry where object_id = p_shared and event = 'block.added' and subject like 'm%') = 0,
    'C2-1: adding 25 blocks at once is one block.added entry with a count of 25'
  );

  -- -------------------------------------------------------------------------
  -- C2-1 Records: properties and relations
  -- -------------------------------------------------------------------------
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Activity', 'activity-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Activity project', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Book the hall', v_owner, v_volunteer) returning id into v_task;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Budget sign-off', v_owner) returning id into v_hidden_task;

  perform tests.authenticate(v_owner, 'aal2');
  update public.task set due_at = '2026-11-15' where id = v_task;
  reset role;
  v_entry := (select e from public.activity_entry e where object_id = v_task and event = 'property.updated' order by seq desc limit 1);
  perform tests.ok(
    v_entry.subject = 'due' and v_entry.actor_id = v_owner and v_entry.object_type = 'task'
      and v_entry.details -> 'changes' -> 0 ->> 'after' = '2026-11-15',
    'C2-1: a record''s property change is property.updated, named by its property, with the person'
  );
  perform tests.ok((tests.activity_events(v_task))[1] = 'record.created', 'C2-1: a new record starts with record.created');

  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind)
  values (v_org, v_task_type, 'room', 'Room', 'Salle', 'text') returning id into p_public_prop;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, visible_to_roles)
  values (v_org, v_task_type, 'hall_cost', 'Hall cost', 'Coût de la salle', 'currency', '{owner,admin}')
  returning id into p_private_prop;
  insert into public.property_value (object_id, property_id, value_text) values (v_task, p_public_prop, 'Main hall');
  insert into public.property_value (object_id, property_id, value_number) values (v_task, p_private_prop, 450);
  perform tests.ok(
    (select count(*) from public.activity_entry where object_id = v_task and event = 'property.updated'
       and subject in ('room', 'hall_cost')) = 2,
    'C2-1: custom property values are recorded too'
  );

  insert into public.object_relation (organization_id, from_id, to_id, relation_type_id)
  values (v_org, v_task, v_hidden_task, v_related);
  delete from public.object_relation where from_id = v_task and to_id = v_hidden_task;
  perform tests.ok(
    (select array_agg(event order by seq) from public.activity_entry where object_id = v_task and event like 'relation.%')
      = array['relation.linked', 'relation.unlinked']
      and (select bool_and(subject = v_hidden_task::text) from public.activity_entry where object_id = v_task and event like 'relation.%'),
    'C2-1: linking and unlinking records relation.linked and relation.unlinked, naming the other record'
  );
  perform tests.ok(
    (select count(*) from public.activity_entry where object_id = v_hidden_task and event like 'relation.%') = 2,
    'C2-1: the other end records the relation too'
  );

  -- -------------------------------------------------------------------------
  -- C2-4 Permission changes
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  update public.page set visibility = 'private' where id = p_parent;
  reset role;
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = p_parent and event = 'permission.changed'
      and details @> '{"field": "visibility", "before": "workspace", "after": "private"}'),
    'C2-4: making a page private is a permission.changed entry'
  );
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = p_shared and event = 'permission.changed'),
    'C2-4: the page inside it, which follows its visibility, records the change too'
  );

  insert into public.access_grant (organization_id, object_id, principal_kind, user_id, role_id, created_by)
  values (v_org, v_task, 'person', v_guest, v_follower, v_owner) returning id into v_grant;
  update public.access_grant set role_id = v_contributor where id = v_grant;
  delete from public.access_grant where id = v_grant;
  perform tests.ok(
    (select array_agg(event order by seq) from public.activity_entry where object_id = v_task and subject = v_grant::text)
      = array['permission.granted', 'permission.changed', 'permission.revoked']
      and exists (select 1 from public.activity_entry where object_id = v_task and event = 'permission.granted'
        and details ->> 'user_id' = v_volunteer::text),
    'C2-4: sharing a record, changing the role and removing it are recorded, as is the assignee''s mirrored access'
  );
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = v_task and event = 'permission.changed'
      and details -> 'before_role' ->> 'key' = 'task_follower' and details -> 'role' ->> 'key' = 'task_contributor'
      and details ->> 'user_id' = v_guest::text),
    'C2-4: a role change keeps the person, the old role and the new role'
  );

  -- -------------------------------------------------------------------------
  -- C2-3 Restoring a version
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  update public.page set visibility = 'workspace' where id = p_parent;
  perform tests.ok((select visibility from public.page where id = p_shared) = 'workspace',
    'C2-4: the page is shared with the workspace again');
  perform public.save_object_version(p_shared, 'page', 'manual', '{"version":1,"blocks":[]}'::jsonb, '{}'::jsonb, 'Before trip');
  select count(*), (array_agg(id order by seq))[1] into v_before_restore, v_first
  from public.activity_entry where object_id = p_shared;
  perform public.save_object_version(p_shared, 'page', 'restore', '{"version":1,"blocks":[]}'::jsonb, '{}'::jsonb, null);
  update public.editor_document set content = tests.activity_doc(jsonb_build_array(
    tests.activity_block('a', 'Welcome'), tests.activity_block('b', 'Parking')))
  where object_id = p_shared;
  reset role;
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = p_shared and event = 'version.saved'
      and details ->> 'label' = 'Before trip'),
    'C2-3: saving a named version is recorded'
  );
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = p_shared and event = 'version.restored'
      and actor_id = v_staff),
    'C2-3: restoring a version adds version.restored, by the person who restored'
  );
  perform tests.ok(
    (select count(*) from public.activity_entry where object_id = p_shared) > v_before_restore
      and (select count(*) from public.activity_entry where object_id = p_shared
           and seq <= (select seq from public.activity_entry where object_id = p_shared and event = 'version.saved')) = v_before_restore
      and exists (select 1 from public.activity_entry where id = v_first and event = 'page.created'),
    'C2-3: every entry from before the restore is kept, from page.created on'
  );
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = p_shared and event = 'block.added' and subject = 'b'
      and seq > (select seq from public.activity_entry where object_id = p_shared and event = 'version.restored')),
    'C2-3: the restored content''s block changes are recorded after the restore entry'
  );
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = p_shared and event = 'block.updated' and subject = 'a'
      and details ->> 'text' = 'Welcome, everyone!')
      and exists (select 1 from public.activity_entry where object_id = p_shared and event = 'block.updated' and subject = 'a'
      and details ->> 'text' = 'Welcome'
      and seq > (select seq from public.activity_entry where object_id = p_shared and event = 'version.restored')),
    'C2-3: an edit after a restore is a new entry; the edit from before the restore keeps its text'
  );

  -- -------------------------------------------------------------------------
  -- C2-5 Reading: only what the reader can open
  -- -------------------------------------------------------------------------
  select count(*) into v_count from public.activity_entry where object_id = p_shared;
  for v_person, v_role in select m.user_id, m.role::text from public.organization_membership m where m.organization_id = v_org loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      -- Each object: either every entry the owner of the data would see, or none.
      perform tests.ok(
        (select count(*) from public.activity_entry where object_id = p_shared)
          = case when public.can_page(p_shared, 'view') then v_count else 0 end,
        format('C2-5: %s (%s) reads the workspace page''s activity exactly when they can open it', v_person, v_level)
      );
      perform tests.ok(
        ((select count(*) from public.activity_entry where object_id = p_private) > 0) = (v_person = v_staff),
        format('C2-5: %s (%s) reads the private page''s activity only if they wrote it', v_person, v_level)
      );
      perform tests.ok(
        ((select count(*) from public.activity_entry where object_id = v_task) > 0) = public.can(v_task, 'view')
          and ((select count(*) from public.activity_entry where object_id = v_hidden_task) > 0) = public.can(v_hidden_task, 'view'),
        format('C2-5: %s (%s) reads a record''s activity exactly when they can open it', v_person, v_level)
      );
      perform tests.ok(
        exists (select 1 from public.activity_entry where object_id = v_task and subject = 'hall_cost')
          = (public.can(v_task, 'view') and v_role in ('owner', 'admin')),
        format('C2-5: %s (%s) reads the private property change only if they may see the property', v_person, v_level)
      );
      perform tests.ok(
        exists (select 1 from public.activity_entry where object_id = v_task and event like 'relation.%')
          = (public.can(v_task, 'view') and public.can(v_hidden_task, 'view')),
        format('C2-5: %s (%s) reads a relation entry only if they can open both records', v_person, v_level)
      );
      -- Forbidden writes.
      perform tests.ok(
        tests.activity_raises(format(
          'insert into public.activity_entry (organization_id, object_id, object_type, event, actor_kind) values (%L, %L, ''page'', ''page.updated'', ''system'')',
          v_org, p_shared))
          and tests.activity_rows(format('update public.activity_entry set event = ''page.deleted'' where object_id = %L', p_shared)) <= 0
          and tests.activity_rows(format('delete from public.activity_entry where object_id = %L', p_shared)) <= 0,
        format('C2-5: %s (%s) cannot write, change or delete activity', v_person, v_level)
      );
      reset role;
    end loop;
  end loop;

  perform tests.authenticate(v_volunteer, 'aal1');
  perform tests.ok(
    exists (select 1 from public.activity_entry where object_id = v_task and subject = 'due')
      and not exists (select 1 from public.activity_entry where object_id = p_shared)
      and not exists (select 1 from public.activity_entry where object_id = v_task and subject = 'hall_cost')
      and not exists (select 1 from public.activity_entry where object_id = v_task and event like 'relation.%'),
    'C2-5: the assignee reads their task''s activity, but not a workspace page, the private cost or the hidden relation'
  );
  reset role;

  perform tests.clear_auth();
  perform tests.ok(
    tests.activity_raises('select 1 from public.activity_entry limit 1'),
    'C2-5: a signed-out visitor cannot read activity at all'
  );
  reset role;

  delete from public.page where id = p_shared;
  perform tests.ok(
    (select count(*) from public.activity_entry where object_id = p_shared) = v_count,
    'C2-3: history outlives the object it is about'
  );
end;
$$;

rollback;
