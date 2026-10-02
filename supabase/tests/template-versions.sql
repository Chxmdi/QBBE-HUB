-- Templates that build hubs, with versions (Workspace OS wave 2, unit T1,
-- migration 20261110010000). Run after qa-users.sql and rls.sql. All
-- mutations roll back.
--
--   T1-1  a page template may hold any block in the editor's registry, and a
--         page made from it holds them;
--   T1-2  using a hub template on a start date creates the page, a project,
--         its milestones and tasks with resolved dates, and a view block that
--         lists exactly those tasks;
--   T1-4  editing makes a new version; pages made from an older version keep
--         their content and record that version;
--   T1-5  a duplicate carries no private pages, no people outside the
--         destination organization and nothing the copier cannot open;
--   T1-6  someone who cannot see a template cannot use it, duplicate it or
--         read its versions.
--
-- Fixture people: owner a1, staff a2, volunteer a3, admin a4, guest a5.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_all_types jsonb;
  v_hub uuid;
  v_draft uuid;
  v_page uuid;
  v_old_page uuid;
  v_new_page uuid;
  v_project uuid;
  v_private_page uuid;
  v_shared_page uuid;
  v_private_lens uuid;
  v_task uuid;
  v_copy uuid;
  v_ok boolean;
  v_n integer;
  v_text text;
  v_json jsonb;
  v_doc jsonb;
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest);

  -- ======================================================== T1-1 any block
  -- One block of every type the registry holds, as the editor saves them.
  select jsonb_agg(jsonb_build_object('id', 'b-' || t.type, 'type', t.type, 'props', '{}'::jsonb, 'children', '[]'::jsonb)
                   order by t.n)
  into v_all_types
  from unnest(app.template_v2_block_types()) with ordinality as t(type, n);
  perform tests.ok(jsonb_array_length(v_all_types) = 29, 'T1-1: the database knows all 29 registry block types');
  perform tests.ok(app.template_v2_document_problem(jsonb_build_object('en', v_all_types, 'fr', v_all_types)) is null,
    'T1-1: a document with every registry block type is accepted');
  perform tests.ok(app.template_v2_document_problem('{"en":[{"type":"script"}],"fr":[]}') is not null,
    'T1-1: a block type the editor does not know is refused');
  perform tests.ok(app.template_v2_document_problem('{"en":[{"type":"paragraph","children":[{"type":"iframe"}]}],"fr":[]}') is not null,
    'T1-1: an unknown type nested in children is refused');
  perform tests.ok(app.template_v2_document_problem('{"en":[],"fr":[],"de":[]}') is not null,
    'T1-1: a document is English and French only');

  -- An admin writes a hub template whose document holds a view block, a task
  -- and a decision block, a checklist, columns and variables and dates.
  perform tests.authenticate(v_admin);
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, status, body)
  values (v_org, 'page', null, 'Event hub', 'Carrefour d''événement', 'published', jsonb_build_object(
    'title', jsonb_build_object('en', 'Event hub', 'fr', 'Carrefour'),
    'blocks', '[]'::jsonb,
    'variables', '["owner"]'::jsonb,
    'document', jsonb_build_object(
      'en', jsonb_build_array(
        jsonb_build_object('id', 'h1', 'type', 'heading', 'props', '{"level":2}'::jsonb,
          'content', '[{"type":"text","text":"Run by {{owner}}","styles":{}}]'::jsonb),
        jsonb_build_object('id', 'c1', 'type', 'checkListItem', 'props', '{"checked":false}'::jsonb,
          'content', '[{"type":"text","text":"Book the room by {{start+7}}","styles":{}}]'::jsonb),
        jsonb_build_object('id', 'v1', 'type', 'query', 'props', jsonb_build_object('preset', 'my_open',
          'spec', '{"version":2,"source":{"type":"task"},"layout":"board"}')),
        jsonb_build_object('id', 't1', 'type', 'task', 'props', '{"objectId":""}'::jsonb),
        jsonb_build_object('id', 'd1', 'type', 'decision', 'props', '{"objectId":""}'::jsonb),
        jsonb_build_object('id', 'col', 'type', 'columnList', 'children', jsonb_build_array(
          jsonb_build_object('id', 'colA', 'type', 'column', 'children',
            '[{"id":"p1","type":"paragraph","content":[{"type":"text","text":"Left","styles":{}}]}]'::jsonb)))),
      'fr', jsonb_build_array(
        jsonb_build_object('id', 'h1', 'type', 'heading', 'props', '{"level":2}'::jsonb,
          'content', '[{"type":"text","text":"Animé par {{owner}}","styles":{}}]'::jsonb),
        jsonb_build_object('id', 'c1', 'type', 'checkListItem', 'props', '{"checked":false}'::jsonb,
          'content', '[{"type":"text","text":"Réserver la salle d’ici le {{start+7}}","styles":{}}]'::jsonb))),
    'hub', jsonb_build_object(
      'milestones', '[{"title":{"en":"Venue booked","fr":"Salle réservée"},"offsets":{"due":14}},{"title":{"en":"Event day","fr":"Jour J"},"offsets":{"due":42}}]'::jsonb,
      'tasks', '[{"title":{"en":"Book the venue","fr":"Réserver la salle"},"priority":"high","offsets":{"due":10},"milestone":0},{"title":{"en":"Send invitations","fr":"Envoyer les invitations"},"offsets":{"start":14,"due":21},"milestone":1},{"title":{"en":"Thank volunteers","fr":"Remercier les bénévoles"},"offsets":{"due":45}}]'::jsonb)))
  returning id into v_hub;
  reset role;
  select version into v_n from public.template_v2 where id = v_hub;
  perform tests.ok(v_n = 1, 'T1-4: a new template is version 1');

  -- ======================================================== T1-2 hub
  perform tests.authenticate(v_admin);
  v_page := public.apply_page_template_v2(v_hub, null, '', date '2031-05-01', '{"owner":"Jane \"JD\" Doe","locale":"en"}');
  reset role;
  select project_id into v_project from public.page_template_origin where page_id = v_page;
  perform tests.ok(v_project is not null, 'T1-2: using a hub template creates a project for the hub');
  select name || '|' || start_date::text || '|' || target_date::text || '|' || created_by::text into v_text
  from public.project where id = v_project;
  perform tests.ok(v_text = 'Event hub|2031-05-01|2031-06-15|' || v_admin::text,
    'T1-2: the hub project is named after the page and runs from the start to the last date');
  select string_agg(name || ':' || due_date::text, '|' order by due_date) into v_text
  from public.milestone where project_id = v_project;
  perform tests.ok(v_text = 'Venue booked:2031-05-15|Event day:2031-06-12', 'T1-2: milestones get resolved dates');
  select string_agg(t.title || ':' || coalesce(t.start_at::date::text, '-') || ':' || t.due_at::date::text || ':'
                    || t.priority::text || ':' || coalesce(m.name, '-'), '|' order by t.due_at) into v_text
  from public.task t left join public.milestone m on m.id = t.milestone_id where t.project_id = v_project;
  perform tests.ok(v_text = 'Book the venue:-:2031-05-11:high:Venue booked|Send invitations:2031-05-15:2031-05-22:medium:Event day|Thank volunteers:-:2031-06-15:medium:-',
    'T1-2: tasks get resolved dates, priorities and their milestones');

  -- The page: the document rendered (variables JSON-safe, date tokens filled), then the view.
  select content into v_json from public.editor_document where object_id = v_page;
  perform tests.ok(v_json->'blocks'->0->'content'->0->>'text' = 'Run by Jane "JD" Doe',
    'T1-1: a variable with quotes is filled without breaking the document');
  perform tests.ok(v_json->'blocks'->1->'content'->0->>'text' = 'Book the room by 2031-05-08',
    'T1-2: a {{start+N}} token becomes the resolved date');
  select string_agg(distinct type, ',' order by type) into v_text from public.block where object_id = v_page;
  perform tests.ok(v_text = 'checkListItem,column,columnList,decision,heading,paragraph,query,task',
    'T1-1: the page holds the template''s view, task, decision, checklist and column blocks');
  v_json := (select (b->'props'->>'spec')::jsonb from jsonb_array_elements(v_json->'blocks') b
             where b->>'type' = 'query' and b->'props'->>'spec' like '%contains%');
  perform tests.ok(v_json->'where' = jsonb_build_array(jsonb_build_object('path', 'project', 'op', 'contains', 'value', v_project::text))
    and v_json->>'version' = '2' and v_json->'source' = '{"type":"task"}',
    'T1-2: the page has a task view filtered to the hub''s project');
  perform tests.authenticate(v_admin);
  v_json := public.lens_query(jsonb_build_object('version', 1, 'type', 'task',
    'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object(
      'property', 'project', 'operator', 'contains', 'value', v_json->'where'->0->'value')))), 'America/Toronto');
  reset role;
  perform tests.ok((v_json->>'total')::integer = 3, 'T1-2: the view lists exactly the three tasks the template created');

  -- French: the French document and names.
  perform tests.authenticate(v_admin);
  v_page := public.apply_page_template_v2(v_hub, null, 'Fête', date '2031-05-01', '{"owner":"Marie","locale":"fr-CA"}');
  reset role;
  select content into v_json from public.editor_document where object_id = v_page;
  perform tests.ok(v_json->'blocks'->1->'content'->0->>'text' = 'Réserver la salle d’ici le 2031-05-08'
    and (select count(*) from public.milestone m join public.page_template_origin o on o.project_id = m.project_id
         where o.page_id = v_page and m.name = 'Jour J') = 1,
    'T1-2: in French the page, milestones and tasks are French');

  -- Whoever may not create the project may not use the hub; nothing is left half-made.
  select count(*) into v_n from public.page;
  perform tests.authenticate(v_staff);
  begin
    perform public.apply_page_template_v2(v_hub, null, 'Staff hub', date '2031-05-01', '{}');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  perform tests.ok(v_ok, 'T1-2: staff without a program they manage cannot create a hub outside any program');
  perform tests.ok((select count(*) from public.page) = v_n and not exists (select 1 from public.project where name = 'Staff hub'),
    'T1-2: a refused hub leaves no page and no project');

  -- ======================================================== T1-4 versions
  perform tests.authenticate(v_admin);
  v_old_page := public.apply_page_template_v2(v_hub, null, 'From v1', date '2031-05-01', '{"owner":"A","locale":"en"}');
  update public.template_v2 set status = 'published' where id = v_hub;
  perform tests.ok((select version from public.template_v2 where id = v_hub) = 1, 'T1-4: saving without a change keeps the version');
  update public.template_v2
  set body = jsonb_set(body, '{document,en,0,content,0,text}', '"Led by {{owner}}"'), version = 99
  where id = v_hub;
  perform tests.ok((select version from public.template_v2 where id = v_hub) = 2,
    'T1-4: an edit makes version 2, whatever version the client sends');
  v_new_page := public.apply_page_template_v2(v_hub, null, 'From v2', date '2031-05-01', '{"owner":"A","locale":"en"}');
  select count(*) into v_n from public.template_v2_version where template_id = v_hub;
  perform tests.ok(v_n = 2, 'T1-4: both versions are kept');
  perform tests.ok((select body->'document'->'en'->0->'content'->0->>'text' from public.template_v2_version
                    where template_id = v_hub and version = 1) = 'Run by {{owner}}',
    'T1-4: version 1 keeps what it said');
  reset role;
  select content->'blocks'->0->'content'->0->>'text' into v_text from public.editor_document where object_id = v_old_page;
  perform tests.ok(v_text = 'Run by A', 'T1-4: a page made from version 1 keeps its content after the edit');
  select content->'blocks'->0->'content'->0->>'text' into v_text from public.editor_document where object_id = v_new_page;
  perform tests.ok(v_text = 'Led by A', 'T1-4: a page made from version 2 has the new content');
  select string_agg(o.template_version::text || ':' || o.template_name_en, '|' order by o.template_version) into v_text
  from public.page_template_origin o where o.page_id in (v_old_page, v_new_page);
  perform tests.ok(v_text = '1:Event hub|2:Event hub', 'T1-4: each page records the version it came from');

  -- Versions and origins are written by the server only.
  perform tests.authenticate(v_admin);
  begin
    insert into public.template_v2_version (template_id, organization_id, version, name_en, name_fr, body)
    values (v_hub, v_org, 3, 'x', 'x', '{}');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'T1-4: nobody writes a version directly');
  begin
    update public.template_v2_version set name_en = 'forged' where template_id = v_hub;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'T1-4: nobody rewrites a version');
  begin
    delete from public.template_v2_version where template_id = v_hub;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'T1-4: nobody deletes a version');
  begin
    update public.page_template_origin set template_version = 5 where page_id = v_old_page;
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'T1-4: nobody rewrites where a page came from');
  reset role;

  -- An origin names only the caller's own page, and copies the version's own name.
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Owner page') returning id into v_shared_page;
  perform tests.authenticate(v_staff);
  begin
    insert into public.page_template_origin (page_id, version_id)
    values (v_shared_page, (select id from public.template_v2_version where template_id = v_hub and version = 1));
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  perform tests.ok(v_ok, 'T1-4: an origin cannot be claimed for someone else''s page');

  -- ======================================================== T1-6 no access
  perform tests.authenticate(v_staff);
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, status, body)
  values (v_org, 'page', null, 'Staff draft', 'Brouillon', 'draft',
    '{"title":{"en":"Draft","fr":"Brouillon"},"blocks":[],"document":{"en":[{"type":"paragraph"}],"fr":[{"type":"paragraph"}]}}')
  returning id into v_draft;
  reset role;
  for r in select * from (values (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    select count(*) into v_n from public.template_v2 where id = v_draft;
    perform tests.ok(v_n = 0, format('T1-6: %s cannot see (or preview) a staff draft', r.who));
    select count(*) into v_n from public.template_v2_version where template_id = v_draft;
    perform tests.ok(v_n = 0, format('T1-6: %s cannot read the draft''s versions', r.who));
    begin
      perform public.apply_page_template_v2(v_draft, null, '', date '2031-05-01', '{}');
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    perform tests.ok(v_ok, format('T1-6: %s cannot use a template they cannot see', r.who));
    begin
      perform public.duplicate_template_v2(v_draft, v_org);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    perform tests.ok(v_ok, format('T1-6: %s cannot duplicate a template they cannot see', r.who));
    reset role;
  end loop;

  -- Someone outside the organization sees none of its templates.
  insert into public.organization (name, slug)
  values ('Template other org', 'template-other-org-' || left(gen_random_uuid()::text, 8))
  returning id into v_other_org;
  update public.organization_membership set status = 'deactivated' where organization_id = v_org and user_id = v_guest;
  insert into public.organization_membership (organization_id, user_id, role, status)
  values (v_other_org, v_guest, 'staff', 'active');
  perform tests.authenticate(v_guest);
  select count(*) into v_n from public.template_v2 where id in (v_hub, v_draft);
  perform tests.ok(v_n = 0, 'T1-6: a member of another organization sees none of this one''s templates');
  begin
    perform public.duplicate_template_v2(v_hub, v_other_org);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'T1-6: a member of another organization cannot copy one into theirs');
  select count(*) into v_n from public.page_template_origin where page_id = v_old_page;
  perform tests.ok(v_n = 0, 'T1-6: nor see where this organization''s pages came from');
  reset role;
  update public.organization_membership set status = 'active' where organization_id = v_org and user_id = v_guest;
  delete from public.organization_membership where organization_id = v_other_org and user_id = v_guest;

  -- The draft's author may duplicate it; a volunteer may not write templates at all.
  perform tests.authenticate(v_staff);
  v_copy := public.duplicate_template_v2(v_draft, null);
  select name_en || '|' || name_fr || '|' || status || '|' || version::text || '|' || created_by::text into v_text
  from public.template_v2 where id = v_copy;
  perform tests.ok(v_text = 'Copy of Staff draft|Copie de Brouillon|draft|1|' || v_staff::text,
    'T1-5: a copy is the copier''s draft, version 1');
  reset role;
  perform tests.authenticate(v_volunteer);
  begin
    perform public.duplicate_template_v2(v_hub, v_org);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  perform tests.ok(v_ok, 'T1-6: a volunteer, who cannot write templates, cannot duplicate one');

  -- ======================================================== T1-5 no private data
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_owner, 'Owner private notes') returning id into v_private_page;
  insert into public.lens (organization_id, owner_id, name, kind, type_key, visibility, spec)
  values (v_org, v_owner, 'Private view', 'table', 'task', 'personal', '{"version":1,"type":"task"}') returning id into v_private_lens;
  insert into public.task (organization_id, title, created_by, requester_id)
  values (v_org, 'Org task', v_owner, v_owner) returning id into v_task;
  -- The owner is also staff in a second organization.
  insert into public.organization_membership (organization_id, user_id, role, status)
  values (v_other_org, v_owner, 'staff', 'active');

  v_doc := jsonb_build_array(
    jsonb_build_object('id', 'a', 'type', 'pageLink', 'props', jsonb_build_object('objectId', v_private_page)),
    jsonb_build_object('id', 'b', 'type', 'pageLink', 'props', jsonb_build_object('objectId', v_shared_page)),
    jsonb_build_object('id', 'c', 'type', 'person', 'props', jsonb_build_object('objectId', v_staff)),
    jsonb_build_object('id', 'd', 'type', 'person', 'props', jsonb_build_object('objectId', v_owner)),
    jsonb_build_object('id', 'e', 'type', 'task', 'props', jsonb_build_object('objectId', v_task)),
    jsonb_build_object('id', 'f', 'type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'link', 'href', '/pages/' || v_private_page,
        'content', '[{"type":"text","text":"secret plan","styles":{}}]'::jsonb),
      jsonb_build_object('type', 'link', 'href', '/pages/' || v_shared_page,
        'content', '[{"type":"text","text":"team page","styles":{}}]'::jsonb))),
    jsonb_build_object('id', 'g', 'type', 'query', 'props', jsonb_build_object('preset', 'my_open', 'spec',
      jsonb_build_object('version', 2, 'source', jsonb_build_object('lensId', v_private_lens),
        'where', jsonb_build_array(
          jsonb_build_object('path', 'assignee', 'op', 'contains', 'value', v_staff),
          jsonb_build_object('path', 'title', 'op', 'contains', 'value', 'gala')))::text)),
    jsonb_build_object('id', 'h', 'type', 'syncedBlock', 'props', jsonb_build_object('syncedBlockId', gen_random_uuid(), 'role', 'copy')),
    jsonb_build_object('id', 'i', 'type', 'toggleListItem', 'children', jsonb_build_array(
      jsonb_build_object('id', 'j', 'type', 'pageLink', 'props', jsonb_build_object('objectId', v_private_page)))));
  perform tests.authenticate(v_owner);
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, status, body)
  values (v_org, 'page', null, 'Board pack', 'Dossier du CA', 'published', jsonb_build_object(
    'title', '{"en":"Board pack","fr":"Dossier"}'::jsonb, 'blocks', '[]'::jsonb,
    'document', jsonb_build_object('en', v_doc, 'fr', v_doc)))
  returning id into v_hub;

  -- Into the same organization: private pages and private views are left out; members and open pages stay.
  v_copy := public.duplicate_template_v2(v_hub, v_org);
  select body->'document'->'en' into v_json from public.template_v2 where id = v_copy;
  perform tests.ok(v_json->0->'props'->>'objectId' = '', 'T1-5: a link to a private page is left out of the copy');
  perform tests.ok(v_json->1->'props'->>'objectId' = v_shared_page::text, 'T1-5: a link to a workspace page stays');
  perform tests.ok(v_json->2->'props'->>'objectId' = v_staff::text and v_json->3->'props'->>'objectId' = v_owner::text,
    'T1-5: members of the organization stay');
  perform tests.ok(v_json->5->'content' = jsonb_build_array(
      '{"type":"text","text":"secret plan","styles":{}}'::jsonb,
      jsonb_build_object('type', 'link', 'href', '/pages/' || v_shared_page,
        'content', '[{"type":"text","text":"team page","styles":{}}]'::jsonb)),
    'T1-5: an inline link to a private page becomes plain text; others stay links');
  v_text := v_json->6->'props'->>'spec';
  perform tests.ok(v_text::jsonb->'source' = '{"type":"task"}' and v_text not like '%' || v_private_lens::text || '%'
    and v_text::jsonb->'where' @> jsonb_build_array(jsonb_build_object('path', 'assignee', 'op', 'contains', 'value', v_staff)),
    'T1-5: a private saved view is left out of a view block; conditions on members stay');
  perform tests.ok(v_json->7->'props'->>'syncedBlockId' = '' and v_json->7->'props'->>'role' = 'copy',
    'T1-5: synced content is not carried into a copy');
  perform tests.ok(v_json->8->'children'->0->'props'->>'objectId' = '', 'T1-5: nested blocks are cleaned too');
  perform tests.ok((select body->'document'->'fr' from public.template_v2 where id = v_copy) = v_json,
    'T1-5: the French document is cleaned the same way');
  perform tests.ok(position(v_private_page::text in (select body::text from public.template_v2 where id = v_copy)) = 0
    and position(v_private_page::text in (select body::text from public.template_v2_version where template_id = v_copy)) = 0,
    'T1-5: the private page''s id appears nowhere in the copy or its versions');

  -- Into another organization: nothing of the first one travels.
  v_copy := public.duplicate_template_v2(v_hub, v_other_org);
  select organization_id = v_other_org, body->'document'->'en' into v_ok, v_json from public.template_v2 where id = v_copy;
  reset role;
  perform tests.ok(v_ok, 'T1-5: a copy goes into the organization asked for');
  perform tests.ok(v_json->1->'props'->>'objectId' = '' and v_json->4->'props'->>'objectId' = '',
    'T1-5: pages and tasks of the first organization do not travel');
  perform tests.ok(v_json->2->'props'->>'objectId' = '' and v_json->3->'props'->>'objectId' = v_owner::text,
    'T1-5: people who are not in the destination are left out; the copier, who is, stays');
  perform tests.ok(not ((v_json->6->'props'->>'spec')::jsonb->'where' @> jsonb_build_array(jsonb_build_object('value', v_staff)))
    and (v_json->6->'props'->>'spec')::jsonb->'where' @> '[{"path":"title","op":"contains","value":"gala"}]',
    'T1-5: a view condition naming an outsider is left out; plain conditions stay');
  perform tests.ok(v_json->5->'content'->1 = '{"type":"text","text":"team page","styles":{}}',
    'T1-5: links into the first organization become plain text');
end;
$$;

rollback;
