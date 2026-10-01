-- Workspace OS U9: comments and versions on pages and meetings
-- (20261108040000_page_comments_versions.sql). Run after qa-users.sql and
-- rls.sql; everything is rolled back.
--
-- Fixture people: owner a1, staff a2, volunteer a3, admin a4, guest a5; a9 is
-- made a leadership viewer inside this transaction. The pages: a workspace
-- page the staff member wrote and a private page of theirs. The meeting: one
-- the staff member organizes, with the volunteer as an attendee.
begin;

create or replace function tests.comment_allowed(
  p_org uuid, p_type text, p_parent uuid, p_author uuid, p_block text default null
)
returns boolean
language plpgsql
as $$
begin
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, block_id, anchor)
  values (
    p_org, p_type, p_parent, p_author, 'Probe', p_block,
    case when p_block is null then null
         else jsonb_build_object('start', 0, 'end', 5, 'quote', 'Probe') end
  );
  return true;
exception when insufficient_privilege or check_violation then
  return false;
end;
$$;

create or replace function tests.version_allowed(p_object uuid, p_type text, p_kind text, p_content jsonb)
returns boolean
language plpgsql
as $$
begin
  perform public.save_object_version(p_object, p_type, p_kind, p_content, '{}'::jsonb, 'Probe');
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function tests.document_update_allowed(p_object uuid, p_content jsonb)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.editor_document set content = p_content, content_text = 'Probe' where object_id = p_object;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
exception when insufficient_privilege then
  return false;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  p_shared uuid;
  p_private uuid;
  m_meeting uuid;
  v_block text := 'blk-' || substr(md5(random()::text), 1, 8);
  v_one jsonb := '{"version": 1, "blocks": [{"id": "b1", "type": "paragraph", "text": "First draft"}]}';
  v_two jsonb := '{"version": 1, "blocks": [{"id": "b1", "type": "paragraph", "text": "Second draft"}]}';
  v_doc jsonb := '{"version": 1, "blocks": [{"id": "b1", "type": "paragraph", "content": [{"type": "text", "text": "First draft"}]}]}';
  v_doc2 jsonb := '{"version": 1, "blocks": [{"id": "b1", "type": "paragraph", "content": [{"type": "text", "text": "Second draft"}]}]}';
  v_id uuid;
  v_restore uuid;
  v_count integer;
  v_version integer;
  v_person uuid;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer'
  where user_id = v_viewer and organization_id = v_org;

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_staff, 'Team handbook') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_staff, 'Staff notes') returning id into p_private;
  insert into public.meeting (organization_id, title, organizer_id, starts_at)
  values (v_org, 'Planning', v_staff, now()) returning id into m_meeting;
  insert into public.meeting_attendee (meeting_id, user_id) values (m_meeting, v_volunteer);

  -- -------------------------------------------------------------------------
  -- Hardening
  -- -------------------------------------------------------------------------
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
       ('app', 'can_object_content'), ('public', 'can_object_content'),
       ('public', 'can_read_comment_parent'), ('public', 'can_post_comment'),
       ('public', 'save_object_version'), ('app', 'can_editor_object'),
       ('app', 'editor_document_before_write')
     )),
    'U9: every function is security definer with an empty search_path'
  );
  perform tests.ok(
    not has_function_privilege('anon', 'public.can_object_content(uuid, text, text)', 'execute')
      and has_function_privilege('authenticated', 'public.can_object_content(uuid, text, text)', 'execute'),
    'U9: can_object_content is callable when signed in, not signed out'
  );
  perform tests.ok(
    (select pg_get_constraintdef(oid) from pg_constraint
     where conname = 'record_comment_parent_type_check') like '%''page''%',
    'U9: record_comment accepts the page parent type'
  );
  perform tests.ok(
    (select pg_get_constraintdef(oid) from pg_constraint
     where conname = 'editor_document_object_type_check') like '%''meeting''%',
    'U9: editor_document accepts meeting notes'
  );

  -- -------------------------------------------------------------------------
  -- Comments on a workspace page: the page's read and write rules
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ok(tests.comment_allowed(v_org, 'page', p_shared, v_staff, v_block),
    'staff comments on a block of a workspace page, with a selection anchor');
  perform tests.ok(tests.comment_allowed(v_org, 'page', p_shared, v_staff),
    'staff comments on a workspace page');
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(tests.comment_allowed(v_org, 'page', p_shared, v_owner),
    'owner (two-step) comments on a workspace page');
  select count(*) into v_count from public.record_comment where parent_type = 'page' and parent_id = p_shared;
  perform tests.ok(v_count = 3, 'owner reads every comment on the workspace page');
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  perform tests.ok(tests.comment_allowed(v_org, 'page', p_shared, v_admin),
    'admin (two-step) comments on a workspace page');
  reset role;

  foreach v_person in array array[v_owner, v_admin] loop
    perform tests.authenticate(v_person, 'aal1');
    perform tests.ok(not tests.comment_allowed(v_org, 'page', p_shared, v_person),
      format('%s without the second step cannot comment on a workspace page', v_person));
    select count(*) into v_count from public.record_comment where parent_type = 'page' and parent_id = p_shared;
    perform tests.ok(v_count = 4, format('%s without the second step still reads the page''s comments', v_person));
    reset role;
  end loop;

  perform tests.authenticate(v_viewer, 'aal1');
  select count(*) into v_count from public.record_comment where parent_type = 'page' and parent_id = p_shared;
  perform tests.ok(v_count = 4, 'a leadership viewer reads the comments on a workspace page');
  perform tests.ok(not tests.comment_allowed(v_org, 'page', p_shared, v_viewer),
    'a leadership viewer cannot comment on a workspace page they cannot write');
  reset role;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person, 'aal1');
    perform tests.ok(not tests.comment_allowed(v_org, 'page', p_shared, v_person),
      format('%s cannot comment on a workspace page they cannot see', v_person));
    select count(*) into v_count from public.record_comment where parent_type = 'page' and parent_id = p_shared;
    perform tests.ok(v_count = 0, format('%s reads no comment on a workspace page they cannot see', v_person));
    perform tests.ok(not public.can_post_comment('page', p_shared),
      format('%s is told they cannot post on the workspace page', v_person));
    reset role;
  end loop;

  -- A private page: its creator only.
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ok(tests.comment_allowed(v_org, 'page', p_private, v_staff, v_block),
    'staff comments on their own private page');
  reset role;
  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(not tests.comment_allowed(v_org, 'page', p_private, v_owner),
    'owner cannot comment on someone else''s private page');
  select count(*) into v_count from public.record_comment where parent_type = 'page' and parent_id = p_private;
  perform tests.ok(v_count = 0, 'owner reads no comment on someone else''s private page');
  reset role;

  -- A page id under another parent type answers nothing.
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ok(not tests.comment_allowed(v_org, 'object', p_shared, v_staff),
    'a page is not an `object` comment parent');
  reset role;

  -- -------------------------------------------------------------------------
  -- Versions of a page: edit_content to save, view to read
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  v_id := public.save_object_version(p_shared, 'page', 'manual', v_one, '{"title": "Team handbook"}', 'Kick-off');
  perform tests.ok(v_id is not null, 'staff saves a named version of a workspace page');
  perform tests.ok(
    public.save_object_version(p_shared, 'page', 'auto', v_two, '{}') is null,
    'an automatic page snapshot within ten minutes of the last version is skipped'
  );
  perform tests.ok(not tests.version_allowed(p_shared, 'task', 'manual', v_one),
    'a page id with another type is refused');
  reset role;

  update public.object_version set created_at = created_at - interval '11 minutes' where object_id = p_shared;
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ok(
    public.save_object_version(p_shared, 'page', 'auto', v_one, '{"title": "Team handbook"}') is null,
    'an unchanged automatic page snapshot is skipped even after ten minutes'
  );
  perform tests.ok(
    public.save_object_version(p_shared, 'page', 'auto', v_two, '{}') is not null,
    'a changed automatic page snapshot is taken after ten minutes'
  );
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(tests.version_allowed(p_shared, 'page', 'manual', v_two),
    'owner (two-step) saves a version of a workspace page');
  reset role;
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(not tests.version_allowed(p_shared, 'page', 'manual', v_two),
    'owner without the second step cannot save a version of a workspace page');
  select count(*) into v_count from public.object_version where object_id = p_shared;
  perform tests.ok(v_count = 3, 'owner without the second step still reads the page''s history');
  reset role;

  perform tests.authenticate(v_viewer, 'aal1');
  select count(*) into v_count from public.object_version where object_id = p_shared;
  perform tests.ok(v_count = 3, 'a leadership viewer reads the history of a workspace page');
  perform tests.ok(not tests.version_allowed(p_shared, 'page', 'manual', v_two),
    'a leadership viewer cannot save a version of a workspace page');
  reset role;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person, 'aal1');
    perform tests.ok(not tests.version_allowed(p_shared, 'page', 'manual', v_two),
      format('%s cannot save a version of a workspace page they cannot see', v_person));
    select count(*) into v_count from public.object_version where object_id = p_shared;
    perform tests.ok(v_count = 0, format('%s reads no history of a workspace page they cannot see', v_person));
    reset role;
  end loop;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(not tests.version_allowed(p_private, 'page', 'manual', v_one),
    'owner cannot save a version of someone else''s private page');
  reset role;

  -- -------------------------------------------------------------------------
  -- Restore: the state before is kept, then the document is rewritten
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  values (p_shared, 'page', v_org, v_doc2, 'Second draft', v_staff);
  select version into v_version from public.editor_document where object_id = p_shared;
  perform tests.ok(v_version = 1, 'the page''s document starts at version 1');

  v_restore := public.save_object_version(p_shared, 'page', 'restore', v_two, '{"title": "Team handbook"}');
  perform tests.ok(v_restore is not null, 'the state before a restore is saved as a restore version');
  perform tests.ok(tests.document_update_allowed(p_shared, v_doc), 'staff writes the restored content back');
  select version, content -> 'blocks' -> 0 -> 'content' -> 0 ->> 'text' into v_version, v_block
  from public.editor_document where object_id = p_shared;
  perform tests.ok(v_version = 2 and v_block = 'First draft',
    'the restore bumps the document version and brings the older text back');
  select count(*) into v_count from public.block where object_id = p_shared and block_id = 'b1' and text = 'First draft';
  perform tests.ok(v_count = 1, 'the derived block rows follow the restored content');
  reset role;

  perform tests.authenticate(v_viewer, 'aal1');
  perform tests.ok(not tests.document_update_allowed(p_shared, v_doc2),
    'a leadership viewer cannot write a page''s document, so cannot restore it');
  reset role;

  -- -------------------------------------------------------------------------
  -- Meetings: the organizer edits, attendees read
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ok(tests.version_allowed(m_meeting, 'meeting', 'manual', v_one),
    'the organizer saves a version of their meeting');
  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  values (m_meeting, 'meeting', v_org, v_doc, 'First draft', v_staff);
  perform tests.ok(true, 'the organizer writes the meeting''s notes as an editor document');
  reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  select count(*) into v_count from public.object_version where object_id = m_meeting;
  perform tests.ok(v_count = 1, 'an attendee reads the meeting''s history');
  perform tests.ok(not tests.version_allowed(m_meeting, 'meeting', 'manual', v_two),
    'an attendee cannot save a version of a meeting they do not manage');
  perform tests.ok(not tests.document_update_allowed(m_meeting, v_doc2),
    'an attendee cannot rewrite the meeting''s notes');
  select count(*) into v_count from public.editor_document where object_id = m_meeting;
  perform tests.ok(v_count = 1, 'an attendee reads the meeting''s notes');
  reset role;

  perform tests.authenticate(v_guest, 'aal1');
  select count(*) into v_count from public.object_version where object_id = m_meeting;
  perform tests.ok(v_count = 0, 'a guest who is not invited reads no history of the meeting');
  perform tests.ok(not tests.version_allowed(m_meeting, 'meeting', 'manual', v_two),
    'a guest who is not invited cannot save a version of the meeting');
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform tests.ok(tests.version_allowed(m_meeting, 'meeting', 'manual', v_two),
    'owner (two-step) saves a version of any meeting');
  reset role;

  -- Signed out: nothing.
  set role anon;
  begin
    select count(*) into v_count from public.object_version where object_id = p_shared;
    perform tests.ok(false, 'signed out should not read versions');
  exception when insufficient_privilege then
    perform tests.ok(true, 'signed out reads no versions');
  end;
  reset role;
end;
$$;

rollback;
