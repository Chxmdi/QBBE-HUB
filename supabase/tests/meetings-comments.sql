-- Epic #13 completion (#33, #34): comment edit/delete/resolve rules, approved
-- links, and agenda combine and carry-forward.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  v_meeting uuid;
  v_later uuid;
  v_item_a uuid;
  v_item_b uuid;
  v_comment uuid;
  n integer;
  failed boolean;
  v_row public.record_comment;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Comments program', 'comments-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;

  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Comments project', v_owner, v_owner)
  returning id into v_project;

  insert into public.project_access_grant (
    organization_id, project_id, user_id, role, source, created_by
  ) values
    (v_org, v_project, v_staff, 'project_manager', 'direct', v_owner),
    (v_org, v_project, v_volunteer, 'read_only', 'direct', v_owner);

  insert into public.approved_document_host (organization_id, host)
  values (v_org, 'drive.google.com')
  on conflict do nothing;

  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at, ends_at)
  values (v_org, v_project, 'Weekly', v_owner, now() + interval '1 day', now() + interval '1 day 1 hour')
  returning id into v_meeting;
  insert into public.meeting (organization_id, project_id, title, organizer_id, starts_at, ends_at)
  values (v_org, v_project, 'Weekly', v_owner, now() + interval '8 days', now() + interval '8 days 1 hour')
  returning id into v_later;

  insert into public.agenda_item (meeting_id, title, kind, sort_key, status, proposed_by, owner_id)
  values (v_meeting, 'Budget', 'discussion', 1, 'accepted', v_owner, v_owner)
  returning id into v_item_a;
  insert into public.agenda_item (meeting_id, title, kind, sort_key, status, proposed_by, owner_id)
  values (v_meeting, 'Venue', 'discussion', 2, 'accepted', v_owner, v_owner)
  returning id into v_item_b;

  -- A comment starts live, whatever the insert claims.
  perform tests.authenticate(v_staff);
  insert into public.record_comment (
    organization_id, parent_type, parent_id, author_id, body, resolved_at
  ) values (v_org, 'project', v_project, v_staff, 'First thought', now())
  returning * into v_row;
  v_comment := v_row.id;
  perform tests.ok(v_row.resolved_at is null, 'a new comment cannot arrive already resolved');

  failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, link_url)
    values (v_org, 'project', v_project, v_staff, 'Look here', 'https://files.example.net/doc');
  exception when check_violation then
    failed := true;
  end;
  perform tests.ok(failed, 'a link to an unapproved host is refused');

  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, link_url)
  values (v_org, 'project', v_project, v_staff, 'The brief', 'https://drive.google.com/file/d/brief');
  select count(*) into n from public.record_comment
  where parent_id = v_project and link_url = 'https://drive.google.com/file/d/brief';
  perform tests.ok(n = 1, 'a link to an approved host is kept');

  -- A reader who is not the author: resolves, but cannot rewrite or delete.
  perform tests.authenticate(v_volunteer);
  failed := false;
  begin
    update public.record_comment set body = 'Rewritten' where id = v_comment;
  exception when insufficient_privilege then
    failed := true;
  end;
  perform tests.ok(failed, 'someone else cannot edit a comment');

  failed := false;
  begin
    update public.record_comment set deleted_at = now() where id = v_comment;
  exception when insufficient_privilege then
    failed := true;
  end;
  perform tests.ok(failed, 'someone else cannot delete a comment');

  update public.record_comment set resolved_at = now() where id = v_comment;
  select resolved_by into v_row.resolved_by from public.record_comment where id = v_comment;
  perform tests.ok(v_row.resolved_by = v_volunteer, 'a reader can resolve a thread, and is recorded as resolver');

  -- The author edits, then deletes; the row stays with a marker and an audit.
  perform tests.authenticate(v_staff);
  update public.record_comment set body = 'First thought, revised' where id = v_comment;
  select * into v_row from public.record_comment where id = v_comment;
  perform tests.ok(v_row.edited_at is not null, 'an edit is marked edited');

  update public.record_comment set deleted_at = now() where id = v_comment;
  select * into v_row from public.record_comment where id = v_comment;
  perform tests.ok(
    v_row.deleted_at is not null and v_row.deleted_by = v_staff,
    'a deletion keeps the row and records who deleted it'
  );

  failed := false;
  begin
    update public.record_comment set body = 'Undeleted?' where id = v_comment;
  exception when insufficient_privilege then
    failed := true;
  end;
  perform tests.ok(failed, 'a deleted comment cannot be changed');

  perform tests.authenticate(v_owner);
  select count(*) into n from public.audit_event
  where object_id = v_comment and event_type = 'comment.deletion' and actor_id = v_staff;
  perform tests.ok(n = 1, 'a comment deletion writes an audit event');

  -- Agenda: combined needs a target, and names it.
  failed := false;
  begin
    update public.agenda_item set status = 'combined' where id = v_item_a;
  exception when check_violation then
    failed := true;
  end;
  perform tests.ok(failed, 'an item cannot be combined without naming the item it went into');

  update public.agenda_item set status = 'combined', combined_into_id = v_item_b where id = v_item_a;
  select count(*) into n from public.agenda_item
  where id = v_item_a and status = 'combined' and combined_into_id = v_item_b;
  perform tests.ok(n = 1, 'the organizer can combine one item into another');

  -- Carry forward keeps the link back to where the item came from.
  insert into public.agenda_item (meeting_id, title, kind, sort_key, status, proposed_by, carried_from_id)
  values (v_later, 'Venue', 'discussion', 1, 'accepted', v_owner, v_item_b);
  select count(*) into n from public.agenda_item
  where meeting_id = v_later and carried_from_id = v_item_b;
  perform tests.ok(n = 1, 'a carried-forward item points back at the original');
end;
$$;

rollback;
