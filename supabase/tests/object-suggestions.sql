-- Workspace OS V1-17 part 2: selection comments and suggested edits
-- (20261103110400_selection_comments_and_suggestions.sql). Run after
-- qa-users.sql and rls.sql; everything is rolled back. Objects are tasks.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_program uuid;
  v_project uuid;
  t_volunteer uuid;
  t_staff uuid;
  s_staff uuid;
  s_volunteer uuid;
  s_other uuid;
  c_anchor uuid;
  v_row public.object_suggestion%rowtype;
  v_count integer;
  v_failed boolean;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Suggestions', 'wos-sg-' || substr(gen_random_uuid()::text, 1, 8), v_owner) returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Suggestions', v_owner, v_owner) returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Volunteer''s task', v_owner, v_volunteer) returning id into t_volunteer;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Staff reviews', v_owner) returning id into t_staff;
  insert into public.task_assignment (task_id, user_id, role) values (t_staff, v_staff, 'reviewer');

  perform tests.ok(
    (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'decide_suggestion'),
    'decide_suggestion is security definer with an empty search_path'
  );
  perform tests.ok(
    not has_table_privilege('authenticated', 'public.object_suggestion', 'update')
      and not has_table_privilege('authenticated', 'public.object_suggestion', 'delete')
      and not has_table_privilege('anon', 'public.object_suggestion', 'select')
      and not has_function_privilege('anon', 'public.decide_suggestion(uuid, text)', 'execute'),
    'suggestions change only through decide_suggestion; signed-out visitors reach nothing'
  );

  -- -------------------------------------------------------------------------
  -- Selection comments
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, block_id, anchor)
  values (v_org, 'task', t_volunteer, v_volunteer, 'Is this the right venue?', 'description',
          '{"start": 4, "end": 10, "quote": "spring"}')
  returning id into c_anchor;
  perform tests.ok(c_anchor is not null, 'volunteer comments on a selection in their task');
  v_failed := false;
  begin
    update public.record_comment set anchor = '{"start": 0, "end": 3, "quote": "abc"}' where id = c_anchor;
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a selection comment''s anchor never moves');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, anchor)
    values (v_org, 'task', t_volunteer, v_volunteer, 'No block', '{"start": 0, "end": 3, "quote": "abc"}');
  exception when check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a selection needs the block it is in');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, block_id, anchor)
    values (v_org, 'task', t_volunteer, v_volunteer, 'Empty', 'description', '{"start": 3, "end": 3, "quote": ""}');
  exception when check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'an empty selection is refused');
  reset role;

  -- -------------------------------------------------------------------------
  -- Suggesting needs comment
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text)
  values (v_org, t_staff, 'task', 'description', 0, 4, 'Plan', 'Draft')
  returning id into s_staff;
  perform tests.ok(s_staff is not null, 'staff who review can suggest an edit');
  v_failed := false;
  begin
    insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text)
    values (v_org, t_volunteer, 'task', 'description', 0, 4, 'Plan', 'Draft');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'staff cannot suggest on an object outside their grants');
  v_failed := false;
  begin
    perform public.decide_suggestion(s_staff, 'accepted');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'staff who only review cannot accept, even their own suggestion');
  v_row := public.decide_suggestion(s_staff, 'withdrawn');
  perform tests.ok(v_row.status = 'withdrawn' and v_row.decided_by = v_staff, 'the author withdraws their suggestion');
  v_failed := false;
  begin
    perform public.decide_suggestion(s_staff, 'withdrawn');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a decided suggestion cannot be decided again');
  reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text)
  values (v_org, t_volunteer, 'task', 'description', 0, 4, 'Plan', 'Draft')
  returning id into s_volunteer;
  insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text)
  values (v_org, t_volunteer, 'task', 'description', 5, 8, 'the', 'our')
  returning id into s_other;
  v_failed := false;
  begin
    insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text, author_id)
    values (v_org, t_volunteer, 'task', 'description', 0, 4, 'Plan', 'Idea', v_owner);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'nobody suggests in someone else''s name');
  v_failed := false;
  begin
    insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text, status)
    values (v_org, t_volunteer, 'task', 'description', 0, 4, 'Plan', 'Idea', 'accepted');
  exception when insufficient_privilege or check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a suggestion starts open');
  v_failed := false;
  begin
    insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text)
    values (v_org, t_volunteer, 'task', 'description', 0, 9, 'Plan', 'Idea');
  exception when check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'the original text must match the range it replaces');
  v_row := public.decide_suggestion(s_volunteer, 'accepted');
  perform tests.ok(v_row.status = 'accepted' and v_row.decided_at is not null, 'volunteer who can edit accepts a suggestion');
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  v_failed := false;
  begin
    insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text)
    values (v_org, t_volunteer, 'task', 'description', 0, 4, 'Plan', 'Idea');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'owner without the second step cannot suggest');
  select count(*) into v_count from public.object_suggestion where object_id = t_volunteer;
  perform tests.ok(v_count = 2, 'owner without the second step still reads suggestions');
  reset role;

  -- Lock: no acceptance and no new suggestions until unlocked.
  perform tests.authenticate(v_admin, 'aal2');
  perform public.lock_object(t_volunteer, 'Final');
  v_failed := false;
  begin
    perform public.decide_suggestion(s_other, 'accepted');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a locked object accepts no suggestion');
  v_failed := false;
  begin
    insert into public.object_suggestion (organization_id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text)
    values (v_org, t_volunteer, 'task', 'description', 0, 4, 'Plan', 'Idea');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a locked object takes no new suggestion');
  v_row := public.decide_suggestion(s_other, 'rejected');
  perform tests.ok(v_row.status = 'rejected' and v_row.decided_by = v_admin, 'admin (two-step) can still reject while locked');
  perform public.unlock_object(t_volunteer);
  reset role;

  -- People with no access.
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_suggestion;
  perform tests.ok(v_count = 0, 'member (guest) sees no suggestions');
  v_failed := false;
  begin
    perform public.decide_suggestion(s_other, 'rejected');
  exception when no_data_found then v_failed := true;
  end;
  perform tests.ok(v_failed, 'member (guest) cannot decide a suggestion they cannot see');
  reset role;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.object_suggestion;
  perform tests.ok(v_count = 0, 'accountant sees no suggestions');
  reset role;
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.object_suggestion where object_id = t_volunteer;
  perform tests.ok(v_count = 0, 'staff sees no suggestions outside their grants');
  reset role;

  perform tests.clear_auth();
  v_failed := false;
  begin
    perform public.decide_suggestion(s_other, 'rejected');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a signed-out visitor cannot decide');
  reset role;
end;
$$;

rollback;
