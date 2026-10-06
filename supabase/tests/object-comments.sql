-- Workspace OS M11: comments, reactions and mentions on any object and block
-- (20261103110100_object_comments.sql). Run after qa-users.sql and rls.sql;
-- everything is rolled back.
--
-- Until the object registry lands, the only objects app.can knows are tasks
-- and projects, so the `object` parent type is exercised on tasks. Roles:
-- owner and admin (at both sign-in levels), staff, volunteer, guest (the
-- ordinary "member" role), an external accountant (a guest with a ledger
-- grant) and a signed-out visitor.
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
  v_program uuid;
  v_project uuid;
  t_open uuid;       -- nobody in particular: owners and admins only
  t_volunteer uuid;  -- assigned to the volunteer
  t_staff uuid;      -- reviewed by the staff member
  v_block text := 'block-' || substr(md5(random()::text), 1, 8);
  c_owner uuid;
  c_volunteer uuid;
  c_staff uuid;
  v_count integer;
  v_ids uuid[];
  v_failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Object comments', 'wos-oc-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_program;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program, 'Object comments', v_owner, v_owner)
  returning id into v_project;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Open to leadership only', v_owner)
  returning id into t_open;
  insert into public.task (organization_id, project_id, title, created_by, assignee_id)
  values (v_org, v_project, 'Assigned to the volunteer', v_owner, v_volunteer)
  returning id into t_volunteer;
  insert into public.task (organization_id, project_id, title, created_by)
  values (v_org, v_project, 'Reviewed by staff', v_owner)
  returning id into t_staff;
  insert into public.task_assignment (task_id, user_id, role)
  values (t_staff, v_staff, 'reviewer');
  insert into public.organization (name, slug)
  values ('Elsewhere', 'wos-oc-else-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_other_org;

  -- -------------------------------------------------------------------------
  -- Hardening
  -- -------------------------------------------------------------------------
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
       ('public', 'can_post_comment'), ('public', 'can_read_comment_parent'),
       ('app', 'guard_object_comment'), ('app', 'can_react_to_comment'),
       ('public', 'can_react_to_comment'), ('app', 'stamp_comment_reaction'),
       ('app', 'person_can_read_comment_parent'), ('public', 'set_comment_mentions')
     )),
    'every new function is security definer with an empty search_path'
  );
  perform tests.ok(
    not has_function_privilege('anon', 'public.set_comment_mentions(uuid, uuid[], uuid[])', 'execute')
      and not has_function_privilege('authenticated', 'app.person_can_read_comment_parent(uuid, text, uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.set_comment_mentions(uuid, uuid[], uuid[])', 'execute'),
    'signed-out visitors cannot set mentions, and nobody calls the impersonation helper directly'
  );
  perform tests.ok(
    (select bool_and(c.relrowsecurity) from pg_class c
     where c.oid in ('public.record_comment_reaction'::regclass, 'public.record_comment_mention'::regclass)),
    'reactions and mentions have row-level security on'
  );

  -- -------------------------------------------------------------------------
  -- Posting on an object: needs the comment capability
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_owner, 'aal2');
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, block_id)
  values (v_org, 'object', t_open, v_owner, 'Owner on a block', v_block)
  returning id into c_owner;
  perform tests.ok(c_owner is not null, 'owner (two-step) comments on a block of any object');
  reset role;

  perform tests.authenticate(v_admin, 'aal2');
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
  values (v_org, 'object', t_open, v_admin, 'Admin note');
  perform tests.ok(true, 'admin (two-step) comments on an object');
  reset role;

  foreach v_ids slice 1 in array array[[v_owner, t_open], [v_admin, t_open]] loop
    perform tests.authenticate(v_ids[1], 'aal1');
    v_failed := false;
    begin
      insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
      values (v_org, 'object', v_ids[2], v_ids[1], 'Without the second step');
    exception when insufficient_privilege then v_failed := true;
    end;
    perform tests.ok(v_failed, format('%s without the second step cannot comment on an object', v_ids[1]));
    select count(*) into v_count from public.record_comment where parent_type = 'object' and parent_id = t_open;
    perform tests.ok(v_count = 2, format('%s without the second step still reads the thread', v_ids[1]));
    reset role;
  end loop;

  perform tests.authenticate(v_volunteer, 'aal1');
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
  values (v_org, 'object', t_volunteer, v_volunteer, 'Volunteer on their task')
  returning id into c_volunteer;
  perform tests.ok(c_volunteer is not null, 'volunteer comments on an object assigned to them');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
    values (v_org, 'object', t_open, v_volunteer, 'Not mine');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'volunteer cannot comment on an object they cannot see');
  select count(*) into v_count from public.record_comment where parent_id = t_open;
  perform tests.ok(v_count = 0, 'volunteer reads no comments on an object they cannot see');
  reset role;

  perform tests.authenticate(v_staff, 'aal1');
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
  values (v_org, 'object', t_staff, v_staff, 'Staff reviewer note')
  returning id into c_staff;
  perform tests.ok(c_staff is not null, 'staff comments on an object they review');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
    values (v_org, 'object', t_open, v_staff, 'Not mine');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'staff cannot comment on an object outside their grants');
  select count(*) into v_count from public.record_comment where parent_id in (t_open, t_volunteer);
  perform tests.ok(v_count = 0, 'staff reads no comments on objects outside their grants');
  reset role;

  perform tests.authenticate(v_guest, 'aal2');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
    values (v_org, 'object', t_volunteer, v_guest, 'Guest');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'member (guest) cannot comment on an object');
  select count(*) into v_count from public.record_comment where parent_type = 'object';
  perform tests.ok(v_count = 0, 'member (guest) reads no object comments');
  reset role;

  -- The external accountant: a guest with a live ledger grant gets nothing more here.
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '30 days', v_owner);
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.record_comment where parent_type = 'object';
  perform tests.ok(v_count = 0, 'accountant reads no object comments');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
    values (v_org, 'object', t_open, v_guest, 'Accountant');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'accountant cannot comment on an object');
  reset role;

  perform tests.clear_auth();
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
    values (v_org, 'object', t_open, v_owner, 'Anonymous');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a signed-out visitor cannot comment');
  v_failed := false;
  begin
    perform 1 from public.record_comment_reaction;
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a signed-out visitor cannot read reactions');
  reset role;

  -- Existing parent types keep their rule: anyone who can read may comment.
  perform tests.authenticate(v_volunteer, 'aal1');
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
  values (v_org, 'task', t_volunteer, v_volunteer, 'Task thread still works');
  perform tests.ok(true, 'the task parent type is unchanged');
  reset role;

  -- Another organization's id on the comment is refused even where the
  -- parent would allow it.
  perform tests.authenticate(v_owner, 'aal2');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body)
    values (v_other_org, 'object', t_open, v_owner, 'Wrong organization');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a comment is posted in the author''s own organization only');

  -- The block a comment is pinned to cannot move.
  v_failed := false;
  begin
    update public.record_comment set block_id = 'another-block' where id = c_owner;
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a comment''s block cannot change');
  v_failed := false;
  begin
    insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, block_id)
    values (v_org, 'object', t_open, v_owner, 'Bad block', 'not a block id!');
  exception when check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a block id is the editor''s short id, nothing else');

  -- Resolve and reopen stamp and clear who resolved.
  update public.record_comment set resolved_at = now() where id = c_owner;
  perform tests.ok(
    (select resolved_by = v_owner from public.record_comment where id = c_owner),
    'resolving an object thread stamps who resolved it'
  );
  update public.record_comment set resolved_at = null where id = c_owner;
  perform tests.ok(
    (select resolved_at is null and resolved_by is null from public.record_comment where id = c_owner),
    'reopening clears the resolution'
  );
  reset role;

  -- -------------------------------------------------------------------------
  -- Reactions
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  insert into public.record_comment_reaction (comment_id, reaction) values (c_volunteer, 'thumbs_up');
  perform tests.ok(
    (select organization_id = v_org and user_id = v_volunteer
     from public.record_comment_reaction where comment_id = c_volunteer),
    'volunteer reacts on a comment they can post on; organization and person are stamped'
  );
  v_failed := false;
  begin
    insert into public.record_comment_reaction (comment_id, reaction) values (c_volunteer, 'shrug');
  exception when check_violation then v_failed := true;
  end;
  perform tests.ok(v_failed, 'only the fixed set of reactions is accepted');
  v_failed := false;
  begin
    insert into public.record_comment_reaction (comment_id, user_id, reaction)
    values (c_volunteer, v_owner, 'heart');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'nobody reacts in someone else''s name');
  v_failed := false;
  begin
    insert into public.record_comment_reaction (comment_id, reaction) values (c_owner, 'heart');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'volunteer cannot react on a comment they cannot see');
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  insert into public.record_comment_reaction (comment_id, reaction) values (c_volunteer, 'heart');
  select count(*) into v_count from public.record_comment_reaction where comment_id = c_volunteer;
  perform tests.ok(v_count = 2, 'owner reacts too and sees every reaction on the comment');
  delete from public.record_comment_reaction where comment_id = c_volunteer and reaction = 'thumbs_up';
  reset role;
  select count(*) into v_count from public.record_comment_reaction where comment_id = c_volunteer;
  perform tests.ok(v_count = 2, 'a person cannot take back someone else''s reaction');

  perform tests.authenticate(v_owner, 'aal1');
  v_failed := false;
  begin
    insert into public.record_comment_reaction (comment_id, reaction) values (c_owner, 'eyes');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'owner without the second step cannot react on an object comment');
  reset role;

  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.record_comment_reaction where comment_id = c_volunteer;
  perform tests.ok(v_count = 0, 'staff sees no reactions on comments they cannot read');
  reset role;
  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.record_comment_reaction;
  perform tests.ok(v_count = 0, 'member and accountant see no reactions');
  reset role;

  perform tests.authenticate(v_volunteer, 'aal1');
  delete from public.record_comment_reaction where comment_id = c_volunteer and reaction = 'thumbs_up';
  get diagnostics v_count = row_count;
  perform tests.ok(v_count = 1, 'volunteer takes back their own reaction');
  reset role;

  -- -------------------------------------------------------------------------
  -- Mentions
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_volunteer, 'aal1');
  select array_agg(x) into v_ids from public.set_comment_mentions(
    c_volunteer,
    array[v_owner, v_staff, v_guest, v_volunteer],
    array[t_volunteer, t_open]
  ) x;
  perform tests.ok(
    v_ids = array[v_owner],
    'only mentioned people who can read the record are returned for notification'
  );
  perform tests.ok(
    (select auth.uid()) = v_volunteer,
    'checking the mentioned people leaves the caller''s identity untouched'
  );
  select count(*) into v_count from public.record_comment_mention
  where comment_id = c_volunteer and target_kind = 'object';
  perform tests.ok(v_count = 1, 'an object the author cannot see is not recorded as mentioned');
  select array_agg(target_id order by target_id) into v_ids from public.record_comment_mention
  where comment_id = c_volunteer and target_kind = 'person' and notified_at is null;
  perform tests.ok(
    v_ids = (select array_agg(x order by x) from unnest(array[v_staff, v_guest]) x),
    'people who cannot read the record are recorded but not notified; the author is never recorded'
  );
  select count(*) into v_count from public.set_comment_mentions(
    c_volunteer, array[v_owner, v_staff], array[t_volunteer]
  );
  perform tests.ok(v_count = 0, 'a person already mentioned in this comment is not notified twice');
  select count(*) into v_count from public.record_comment_mention
  where comment_id = c_volunteer and target_kind = 'person';
  perform tests.ok(v_count = 2, 'mentions dropped by an edit are removed');
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  v_failed := false;
  begin
    perform public.set_comment_mentions(c_volunteer, array[v_admin], null);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'only the comment''s author sets its mentions');
  select count(*) into v_count from public.record_comment_mention where comment_id = c_volunteer;
  perform tests.ok(v_count = 3, 'owner reads the mentions on a comment they can read');
  v_failed := false;
  begin
    insert into public.record_comment_mention (comment_id, organization_id, target_kind, target_id)
    values (c_owner, v_org, 'person', v_admin);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'mentions are never written directly');
  reset role;

  perform tests.authenticate(v_guest, 'aal2');
  select count(*) into v_count from public.record_comment_mention;
  perform tests.ok(v_count = 0, 'member and accountant read no mentions');
  reset role;
  perform tests.authenticate(v_staff, 'aal1');
  select count(*) into v_count from public.record_comment_mention;
  perform tests.ok(v_count = 0, 'staff reads no mentions on comments they cannot read');
  reset role;

  -- A deleted comment takes no new mentions.
  perform tests.authenticate(v_volunteer, 'aal1');
  update public.record_comment set deleted_at = now() where id = c_volunteer;
  v_failed := false;
  begin
    perform public.set_comment_mentions(c_volunteer, array[v_owner], null);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a deleted comment cannot gain mentions');
  v_failed := false;
  begin
    insert into public.record_comment_reaction (comment_id, reaction) values (c_volunteer, 'eyes');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform tests.ok(v_failed, 'a deleted comment cannot gain reactions');
  reset role;
end;
$$;

rollback;
