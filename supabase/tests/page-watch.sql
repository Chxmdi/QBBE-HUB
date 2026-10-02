-- Workspace OS wave 2, C3: watched pages and notification categories
-- (20261110040000_page_watch.sql). Run after qa-users.sql and rls.sql;
-- everything is rolled back.
--
-- Fixture people: owner a1, staff a2, volunteer a3, admin a4, guest a5. The
-- pages: a workspace page the staff member wrote and a private page of theirs.
begin;

create or replace function tests.watch_allowed(p_page uuid, p_user uuid, p_org uuid default null)
returns boolean
language plpgsql
as $$
begin
  if p_org is null then
    insert into public.page_watch (page_id, user_id) values (p_page, p_user);
  else
    insert into public.page_watch (page_id, user_id, organization_id) values (p_page, p_user, p_org);
  end if;
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

-- Posts a page comment as the signed-in person and returns its id.
create or replace function tests.page_comment(
  p_org uuid, p_page uuid, p_author uuid, p_body text, p_parent uuid default null, p_block text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.record_comment (organization_id, parent_type, parent_id, author_id, body, parent_comment_id, block_id)
  values (p_org, 'page', p_page, p_author, p_body, p_parent, p_block)
  returning id into v_id;
  return v_id;
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
  v_org uuid;
  v_other_org uuid;
  p_shared uuid;
  p_private uuid;
  c_first uuid;
  c_reply uuid;
  c_later uuid;
  c_mention uuid;
  c_muted uuid;
  v_count integer;
  v_text text;
  v_people uuid[];
  v_person uuid;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner;
  insert into public.organization (name, slug) values ('Elsewhere', 'elsewhere-' || substr(md5(random()::text), 1, 8))
  returning id into v_other_org;
  -- Each person reads their notifications in their own language.
  update public.user_profile set locale = 'fr-CA' where id = v_admin;
  update public.user_profile set locale = 'en' where id in (v_owner, v_staff);

  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_staff, 'Team handbook') returning id into p_shared;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_staff, 'Staff notes') returning id into p_private;

  -- -------------------------------------------------------------------------
  -- Hardening
  -- -------------------------------------------------------------------------
  perform tests.ok(
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (
       ('app', 'page_watch_before_insert'), ('app', 'notification_hub_filter'),
       ('app', 'notify_page_comment'), ('app', 'notification_supersede_page_comment')
     )),
    'C3: every trigger function is security definer with an empty search_path'
  );
  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.page_watch'::regclass),
    'C3: page_watch has row-level security'
  );
  perform tests.ok(
    not has_table_privilege('anon', 'public.page_watch', 'select')
      and not has_table_privilege('anon', 'public.page_watch', 'insert')
      and not has_table_privilege('authenticated', 'public.page_watch', 'update'),
    'C3: signed out cannot touch watches; nobody updates one'
  );
  perform tests.ok(
    not has_function_privilege('authenticated', 'app.notify_page_comment()', 'execute')
      and not has_function_privilege('authenticated', 'app.notification_hub_filter()', 'execute'),
    'C3: the fan-out and filter run only as triggers'
  );

  -- -------------------------------------------------------------------------
  -- Watching follows the page's read rule; each person sees only their own
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.ok(tests.watch_allowed(p_shared, v_staff, v_other_org), 'staff watches a workspace page');
  perform tests.ok(
    (select organization_id from public.page_watch where page_id = p_shared and user_id = v_staff) = v_org,
    'a watch takes the page''s organization, whatever the caller sends'
  );
  perform tests.ok(tests.watch_allowed(p_private, v_staff), 'staff watches their own private page');
  perform tests.ok(not tests.watch_allowed(p_shared, v_admin), 'staff cannot make someone else watch a page');
  reset role;

  perform tests.authenticate(v_owner, 'aal1');
  perform tests.ok(tests.watch_allowed(p_shared, v_owner), 'owner watches a workspace page');
  perform tests.ok(not tests.watch_allowed(p_private, v_owner), 'owner cannot watch someone else''s private page');
  select count(*) into v_count from public.page_watch;
  perform tests.ok(v_count = 1, 'owner reads only their own watch');
  delete from public.page_watch where user_id = v_staff;
  reset role;
  select count(*) into v_count from public.page_watch where user_id = v_staff;
  perform tests.ok(v_count = 2, 'owner cannot remove someone else''s watches');

  perform tests.authenticate(v_admin, 'aal1');
  perform tests.ok(tests.watch_allowed(p_shared, v_admin), 'admin watches a workspace page');
  reset role;

  foreach v_person in array array[v_volunteer, v_guest] loop
    perform tests.authenticate(v_person, 'aal1');
    perform tests.ok(not tests.watch_allowed(p_shared, v_person),
      format('%s cannot watch a workspace page they cannot open', v_person));
    reset role;
  end loop;

  set role anon;
  begin
    select count(*) into v_count from public.page_watch;
    perform tests.ok(false, 'signed out should not read watches');
  exception when insufficient_privilege then
    perform tests.ok(true, 'signed out reads no watches');
  end;
  reset role;

  -- Someone who lost access keeps a stale watch row (written here as the
  -- database owner); C3-5 checks they are still never told.
  insert into public.page_watch (page_id, user_id) values (p_shared, v_volunteer), (p_private, v_owner);

  -- -------------------------------------------------------------------------
  -- C3-1: watchers hear about comments and replies; the author does not
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  c_first := tests.page_comment(v_org, p_shared, v_staff, 'Please review the budget section.', null, 'b-budget');
  reset role;

  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_first || ':' || v_owner
    and category = 'watched_page' and source_type = 'page' and source_id = p_shared;
  perform tests.ok(v_count = 1, 'a watcher (owner) is told about a new comment');
  select title || ' | ' || link into v_text from public.notification
  where dedupe_key = 'page_comment:' || c_first || ':' || v_owner;
  perform tests.ok(
    v_text = format('%s commented on “Team handbook” | /pages/%s?block=b-budget#comment-%s',
      (select full_name from public.user_profile where id = v_staff), p_shared, c_first),
    'the notice names the author and page, and links to the comment on its block: ' || v_text
  );
  select title into v_text from public.notification where dedupe_key = 'page_comment:' || c_first || ':' || v_admin;
  perform tests.ok(v_text like '% a commenté « Team handbook »', 'a French reader gets the notice in French: ' || v_text);
  select count(*) into v_count from public.notification where dedupe_key like 'page_comment:' || c_first || ':%';
  perform tests.ok(v_count = 2, 'only the two watchers who can open the page are told, not the author');

  -- A reply: the person answered is told as a comment, the other watchers as a watched page.
  perform tests.authenticate(v_admin, 'aal2');
  c_reply := tests.page_comment(v_org, p_shared, v_admin, 'Done, see the new figures.', c_first);
  reset role;
  select category || ' | ' || reason into v_text from public.notification
  where dedupe_key = 'page_comment:' || c_reply || ':' || v_staff;
  perform tests.ok(v_text = 'comment | reply, watching', 'the author of the answered comment is told once, as a reply: ' || v_text);
  select count(*) into v_count from public.notification
  where dedupe_key = 'page_comment:' || c_reply || ':' || v_owner and category = 'watched_page';
  perform tests.ok(v_count = 1, 'other watchers are told about the reply');
  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_reply || ':' || v_admin;
  perform tests.ok(v_count = 0, 'the replier is not told about their own reply');

  -- Each person reads only their own notices.
  perform tests.authenticate(v_owner, 'aal1');
  select count(*) into v_count from public.notification where dedupe_key like 'page_comment:%';
  perform tests.ok(v_count = 2, 'the owner reads only their own page notices');
  -- Unwatching stops the notices.
  delete from public.page_watch where page_id = p_shared;
  reset role;
  perform tests.ok(
    exists (select 1 from public.page_watch where page_id = p_shared and user_id = v_staff),
    'unwatching removes only the person''s own watch'
  );
  perform tests.authenticate(v_staff, 'aal1');
  c_later := tests.page_comment(v_org, p_shared, v_staff, 'One more thing.');
  reset role;
  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_later || ':' || v_owner;
  perform tests.ok(v_count = 0, 'someone who unwatched is not told any more');
  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_later || ':' || v_admin;
  perform tests.ok(v_count = 1, 'someone still watching is');

  -- -------------------------------------------------------------------------
  -- C3-5: nobody is told about a page they cannot open
  -- -------------------------------------------------------------------------
  select count(*) into v_count from public.notification
  where user_id = v_volunteer and source_id = p_shared;
  perform tests.ok(v_count = 0, 'a volunteer with a stale watch on a workspace page is never told');
  perform tests.authenticate(v_staff, 'aal1');
  perform tests.page_comment(v_org, p_private, v_staff, 'Private thought.');
  reset role;
  select count(*) into v_count from public.notification where user_id = v_owner and source_id = p_private;
  perform tests.ok(v_count = 0, 'the owner with a stale watch on a private page is never told');
  -- A former member is not told either.
  update public.organization_membership set status = 'deactivated' where user_id = v_admin and organization_id = v_org;
  perform tests.authenticate(v_staff, 'aal1');
  c_later := tests.page_comment(v_org, p_shared, v_staff, 'After the deactivation.');
  reset role;
  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_later || ':' || v_admin;
  perform tests.ok(v_count = 0, 'a watcher who is no longer an active member is not told');
  update public.organization_membership set status = 'active' where user_id = v_admin and organization_id = v_org;

  -- -------------------------------------------------------------------------
  -- C3-2: a mention notifies the mentioned person once, if they can open it
  -- -------------------------------------------------------------------------
  perform tests.authenticate(v_staff, 'aal1');
  c_mention := tests.page_comment(v_org, p_shared, v_staff, format(
    'Over to @[Admin](person:%s) and @[Volunteer](person:%s).', v_admin, v_volunteer));
  select coalesce(array_agg(x), array[]::uuid[]) into v_people
  from public.set_comment_mentions(c_mention, array[v_admin, v_volunteer], null) as x;
  perform tests.ok(v_people = array[v_admin], 'the mention is returned for notice only for the person who can open the page');
  select coalesce(array_agg(x), array[]::uuid[]) into v_people
  from public.set_comment_mentions(c_mention, array[v_admin, v_volunteer], null) as x;
  perform tests.ok(cardinality(v_people) = 0, 'saving the same mention again tells nobody a second time');
  -- Until the mention notice is stored, the watcher keeps the watched-page one.
  reset role;
  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_mention || ':' || v_admin;
  perform tests.ok(v_count = 1, 'a mentioned watcher keeps the watched-page notice while no mention notice exists');
  -- The comment action then writes the mention notice as the author, as
  -- object-comment.commands.ts does (dedupe key per page and person).
  perform tests.authenticate(v_staff, 'aal1');
  insert into public.notification (user_id, organization_id, category, title, source_type, source_id, link, dedupe_key, reason)
  values (v_admin, v_org, 'mention', 'Staff mentioned you', 'page', p_shared,
    '/pages/' || p_shared || '#comment-' || c_mention, 'page:' || p_shared || ':' || v_admin, 'mentioned');
  reset role;
  select string_agg(category, ',') into v_text from public.notification
  where user_id = v_admin and (dedupe_key = 'page_comment:' || c_mention || ':' || v_admin
    or dedupe_key = 'page:' || p_shared || ':' || v_admin);
  perform tests.ok(v_text = 'mention', 'a mentioned watcher ends with exactly one notice, the mention: ' || coalesce(v_text, 'none'));

  -- A mention whose notice is kept out of the Hub leaves the reply notice in place.
  update public.notification_preference set hub_muted_categories = array['mention'] where user_id = v_owner;
  if not found then
    insert into public.notification_preference (user_id, hub_muted_categories) values (v_owner, array['mention']);
  end if;
  insert into public.page_watch (page_id, user_id) values (p_shared, v_owner);
  perform tests.authenticate(v_staff, 'aal1');
  c_later := tests.page_comment(v_org, p_shared, v_staff, format('Thanks @[Owner](person:%s)', v_owner));
  insert into public.notification (user_id, organization_id, category, title, source_type, source_id, link, dedupe_key)
  values (v_owner, v_org, 'mention', 'Staff mentioned you', 'page', p_shared,
    '/pages/' || p_shared || '#comment-' || c_later, 'page:' || p_shared || ':' || v_owner);
  reset role;
  select string_agg(category, ',') into v_text from public.notification
  where user_id = v_owner and (dedupe_key = 'page_comment:' || c_later || ':' || v_owner
    or dedupe_key = 'page:' || p_shared || ':' || v_owner);
  perform tests.ok(v_text = 'watched_page',
    'someone who muted mentions still hears about the comment as a watcher: ' || coalesce(v_text, 'none'));
  delete from public.page_watch where page_id = p_shared and user_id = v_owner;
  update public.notification_preference set hub_muted_categories = '{}' where user_id = v_owner;

  select count(*) into v_count from public.notification where user_id = v_volunteer;
  perform tests.ok(v_count = 0, 'a mentioned volunteer who cannot open the page gets nothing');
  select count(*) into v_count from public.record_comment_mention
  where comment_id = c_mention and target_id = v_volunteer and notified_at is null;
  perform tests.ok(v_count = 1, 'the volunteer''s mention is recorded as not told');

  -- -------------------------------------------------------------------------
  -- C3-3: each category can be kept out of the Hub, and that is honoured
  -- -------------------------------------------------------------------------
  insert into public.notification_preference (user_id) values (v_staff) on conflict (user_id) do nothing;
  perform tests.authenticate(v_admin, 'aal1');
  insert into public.notification_preference (user_id, hub_muted_categories)
  values (v_admin, array['watched_page'])
  on conflict (user_id) do update set hub_muted_categories = excluded.hub_muted_categories;
  begin
    update public.notification_preference set hub_muted_categories = array['security'] where user_id = v_admin;
    perform tests.ok(false, 'security notices should not be mutable');
  exception when check_violation then
    perform tests.ok(true, 'security notices and announcements cannot be muted');
  end;
  update public.notification_preference set hub_muted_categories = array['mention'] where user_id = v_staff;
  get diagnostics v_count = row_count;
  perform tests.ok(v_count = 0, 'nobody changes someone else''s categories');
  reset role;

  perform tests.authenticate(v_staff, 'aal1');
  c_muted := tests.page_comment(v_org, p_shared, v_staff, 'Muted for the admin.');
  reset role;
  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_muted || ':' || v_admin;
  perform tests.ok(v_count = 0, 'a watcher who muted watched pages is not told');

  -- The comment category: a reply to the admin's comment still reaches them.
  perform tests.authenticate(v_staff, 'aal1');
  c_later := tests.page_comment(v_org, p_shared, v_staff, 'Thanks!', c_reply);
  reset role;
  select count(*) into v_count from public.notification
  where dedupe_key = 'page_comment:' || c_later || ':' || v_admin and category = 'comment';
  perform tests.ok(v_count = 1, 'muting watched pages leaves replies (comments) on');
  update public.notification_preference set hub_muted_categories = array['comment'] where user_id = v_admin;
  perform tests.authenticate(v_staff, 'aal1');
  c_later := tests.page_comment(v_org, p_shared, v_staff, 'Thanks again!', c_reply);
  reset role;
  select count(*) into v_count from public.notification where dedupe_key = 'page_comment:' || c_later || ':' || v_admin;
  perform tests.ok(v_count = 0, 'a person who muted comments is not told about a reply');

  -- Every category, written by any path (here directly, as the jobs do).
  update public.notification_preference
  set hub_muted_categories = array['mention', 'assignment', 'comment', 'approval', 'watched_page']
  where user_id = v_admin;
  insert into public.notification (user_id, organization_id, category, title, dedupe_key)
  select v_admin, v_org, c, 'Probe ' || c, 'c3-probe:' || c
  from unnest(array['mention', 'reply', 'assignment', 'comment', 'approval', 'watched_page',
                    'security', 'announcement', 'due_date']) as c;
  select string_agg(category, ',' order by category) into v_text
  from public.notification where user_id = v_admin and dedupe_key like 'c3-probe:%';
  perform tests.ok(v_text = 'announcement,due_date,security',
    'muted categories are never written; security, announcements and due dates still are: ' || v_text);
  update public.notification_preference set hub_muted_categories = '{}' where user_id = v_admin;
  insert into public.notification (user_id, organization_id, category, title, dedupe_key)
  values (v_admin, v_org, 'approval', 'Probe again', 'c3-probe:approval');
  select count(*) into v_count from public.notification where user_id = v_admin and dedupe_key = 'c3-probe:approval';
  perform tests.ok(v_count = 1, 'turning a category back on lets its notices through again');
end;
$$;

rollback;
