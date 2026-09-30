-- Workspace OS task descriptions in the editor (M4d): conversion, the
-- two-way sync with task.description, and that the sync never lets anyone
-- change a task they could not change before. Run after qa-users.sql and
-- rls.sql. Rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  t_assigned uuid;
  t_reviewed uuid;
  t_unrelated uuid;
  v_version integer;
  v_ok boolean;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;

  -- Conversion ---------------------------------------------------------------------
  perform tests.ok(
    app.plain_text_to_content(E'First\r\n\r\nThird\n') = '{"version":1,"blocks":[
      {"type":"paragraph","content":[{"type":"text","text":"First"}]},
      {"type":"paragraph","content":[]},
      {"type":"paragraph","content":[{"type":"text","text":"Third"}]}]}'::jsonb,
    'task descriptions: one paragraph per line, blank lines kept, trailing breaks dropped');
  perform tests.ok(
    app.plain_text_to_content(null) = '{"version":1,"blocks":[]}'::jsonb
      and app.plain_text_to_content(E'  \n ') = '{"version":1,"blocks":[]}'::jsonb,
    'task descriptions: empty text is an empty document');

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Descriptions', 'descriptions-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Descriptions', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id, description)
  values (v_org, v_project, 'Assigned', v_owner, v_volunteer, E'Line one\nLine two') returning id into t_assigned;
  insert into public.task (organization_id, project_id, title, created_by, description)
  values (v_org, v_project, 'Reviewed', v_owner, 'Review me') returning id into t_reviewed;
  insert into public.task_assignment (task_id, user_id, role) values (t_reviewed, v_volunteer, 'reviewer');
  insert into public.task (organization_id, project_id, title, created_by, description)
  values (v_org, v_project, 'Unrelated', v_owner, 'Not yours') returning id into t_unrelated;

  insert into public.editor_document (object_id, object_type, organization_id, created_by, content, content_text)
  select id, 'task', organization_id, created_by, app.plain_text_to_content(description), description
  from public.task where id in (t_assigned, t_reviewed, t_unrelated);

  perform tests.ok(
    (select count(*) = 2 from public.block where object_id = t_assigned),
    'task descriptions: a converted description has one block per line');

  -- Editor to description ---------------------------------------------------------
  perform tests.authenticate(v_volunteer);
  update public.editor_document
  set content = '{"version":1,"blocks":[{"type":"heading","content":[{"type":"text","text":"Rewritten in the editor"}]}]}',
      content_text = 'Rewritten in the editor'
  where object_id = t_assigned;
  reset role;
  perform tests.ok(
    (select description from public.task where id = t_assigned) = 'Rewritten in the editor',
    'task descriptions: an editor save by the assignee updates task.description');
  select version into v_version from public.editor_document where object_id = t_assigned;
  perform tests.ok(
    (select content -> 'blocks' -> 0 ->> 'type' from public.editor_document where object_id = t_assigned) = 'heading',
    'task descriptions: the editor''s formatting survives its own description update (no echo back)');

  -- Description to editor ----------------------------------------------------------
  perform tests.authenticate(v_owner);
  update public.task set description = E'Changed on the old form\nSecond line' where id = t_assigned;
  reset role;
  perform tests.ok(
    (select content_text = E'Changed on the old form\nSecond line'
        and jsonb_array_length(content -> 'blocks') = 2
        and yjs_state is null
        and version = v_version + 1
     from public.editor_document where object_id = t_assigned),
    'task descriptions: a description change replaces the document once, and resets its editor state');

  -- A change that does not touch the description does not touch the document.
  select version into v_version from public.editor_document where object_id = t_assigned;
  perform tests.authenticate(v_owner);
  update public.task set title = 'Assigned (renamed)' where id = t_assigned;
  reset role;
  perform tests.ok(
    (select version from public.editor_document where object_id = t_assigned) = v_version,
    'task descriptions: other task changes leave the document alone');

  -- No new rights through the sync ------------------------------------------------------
  perform tests.authenticate(v_volunteer);
  begin
    update public.editor_document set content_text = 'Reviewer rewrite', content = '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Reviewer rewrite"}]}]}'
    where object_id = t_reviewed;
    get diagnostics v_ok = row_count;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  perform tests.ok(
    (select description from public.task where id = t_reviewed) = 'Review me',
    'task descriptions: a reviewer cannot rewrite the description through the editor');

  perform tests.authenticate(v_volunteer);
  update public.editor_document set content_text = 'Hijack', content = '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Hijack"}]}]}'
  where object_id = t_unrelated;
  reset role;
  perform tests.ok(
    (select description from public.task where id = t_unrelated) = 'Not yours'
      and (select content_text from public.editor_document where object_id = t_unrelated) = 'Not yours',
    'task descriptions: an unrelated volunteer changes neither the document nor the description');

  perform tests.authenticate(v_guest);
  update public.editor_document set content_text = 'Guest', content = '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Guest"}]}]}'
  where object_id = t_unrelated;
  reset role;
  perform tests.ok(
    (select description from public.task where id = t_unrelated) = 'Not yours',
    'task descriptions: a guest cannot change a description through the editor');

  perform tests.ok(
    (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p where p.pronamespace = 'app'::regnamespace
       and p.proname in ('sync_task_description_from_document', 'sync_document_from_task_description')),
    'task descriptions: both sync functions run with the caller''s rights and pin search_path');
end;
$$;

rollback;
