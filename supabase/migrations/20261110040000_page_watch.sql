-- Workspace OS wave 2, C3: watched pages and notification categories
-- (docs/plans/wave2-plan.md, section 3, C3).
--
--   * page_watch: a person watches a page. Each person reads and changes only
--     their own watches, and can only watch a page they can open
--     (app.can_page 'view').
--   * A new comment on a page notifies the page's watchers (category
--     `watched_page`) and, for a reply, the author of the comment it answers
--     (category `comment`). Nobody is told about a page they cannot open: each
--     recipient is checked as themselves with
--     app.person_can_read_comment_parent, the same check mentions use. When
--     the mention notice for that same comment is then stored (by the comment
--     action, after set_comment_mentions), it replaces this one, so a mention
--     is one notice; if it is never stored, this notice still stands.
--   * notification_preference.hub_muted_categories: the categories a person
--     does not want in the Hub at all (mentions, assigned work, comments,
--     approvals, watched pages). A notification in a muted category is never
--     written, whichever code path creates it, so its email never goes either.
--     Security notices and announcements cannot be muted (the check below).
--
-- In the app all of this sits behind the wos_pages switch: page comments and
-- the watch button only exist while pages do.

-- ---------------------------------------------------------------------------
-- Watches
-- ---------------------------------------------------------------------------

create table public.page_watch (
  page_id uuid not null references public.page (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.user_profile (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (page_id, user_id)
);

create index idx_page_watch_user on public.page_watch (user_id);

comment on table public.page_watch is
  'Workspace OS C3: a person watches a page and is told about comments on it.';

-- The organization always comes from the page, never from the caller.
create or replace function app.page_watch_before_insert()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  select p.organization_id into new.organization_id
  from public.page p where p.id = new.page_id;
  if new.organization_id is null then
    raise exception 'That page does not exist.' using errcode = '42501';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function app.page_watch_before_insert() from public, anon, authenticated;

create trigger page_watch_before_insert
before insert on public.page_watch
for each row execute function app.page_watch_before_insert();

alter table public.page_watch enable row level security;

create policy page_watch_read on public.page_watch
  for select to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(organization_id));

create policy page_watch_insert on public.page_watch
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.is_org_member(organization_id)
    and app.can_page(page_id, 'view')
  );

create policy page_watch_delete on public.page_watch
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.page_watch from anon, authenticated;
grant select, insert, delete on public.page_watch to authenticated;
grant all on public.page_watch to service_role;

-- ---------------------------------------------------------------------------
-- Categories a person keeps out of the Hub
-- ---------------------------------------------------------------------------

alter table public.notification_preference
  add column if not exists hub_muted_categories text[] not null default '{}';
alter table public.notification_preference
  drop constraint if exists notification_preference_hub_muted_known;
alter table public.notification_preference
  add constraint notification_preference_hub_muted_known
  check (hub_muted_categories <@ array['mention', 'assignment', 'comment', 'approval', 'watched_page']::text[]);

comment on column public.notification_preference.hub_muted_categories is
  'Workspace OS C3: notification categories this person does not want at all. '
  'Enforced by app.notification_hub_filter on every notification insert.';

-- The preference category a notification category belongs to, or null when
-- it cannot be muted. Replies follow mentions, as they do for email.
create or replace function app.notification_hub_key(p_category text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_category in ('mention', 'reply') then 'mention'
    when p_category in ('assignment', 'comment', 'approval', 'watched_page') then p_category
    else null
  end;
$$;
revoke all on function app.notification_hub_key(text) from public, anon;
grant execute on function app.notification_hub_key(text) to authenticated, service_role;

create or replace function app.notification_hub_filter()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_key text := app.notification_hub_key(new.category);
begin
  if v_key is not null and exists (
    select 1 from public.notification_preference p
    where p.user_id = new.user_id and v_key = any (p.hub_muted_categories)
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function app.notification_hub_filter() from public, anon, authenticated;

create trigger notification_hub_filter
before insert on public.notification
for each row execute function app.notification_hub_filter();

-- ---------------------------------------------------------------------------
-- Telling watchers and the person answered about a page comment
-- ---------------------------------------------------------------------------

create or replace function app.notify_page_comment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_page public.page%rowtype;
  v_author text;
  v_answered uuid;
  v_snippet text;
  v_link text;
  v_title text;
  r record;
begin
  select * into v_page from public.page p where p.id = new.parent_id;
  if not found or v_page.deleted_at is not null then
    return null;
  end if;

  select coalesce(nullif(btrim(u.full_name), ''), u.email) into v_author
  from public.user_profile u where u.id = new.author_id;

  if new.parent_comment_id is not null then
    select c.author_id into v_answered
    from public.record_comment c
    where c.id = new.parent_comment_id and c.deleted_at is null;
  end if;

  v_snippet := left(regexp_replace(
    new.body,
    '@\[([^\]\n]{1,120})\]\((person|object):[0-9a-fA-F-]{36}\)',
    '@\1',
    'g'
  ), 180);
  v_link := '/pages/' || new.parent_id
    || case when new.block_id is null then '' else '?block=' || new.block_id end
    || '#comment-' || new.id;
  v_title := coalesce(nullif(btrim(v_page.title), ''), '');

  for r in
    select
      who.user_id,
      bool_or(who.answered) as answered,
      bool_or(who.watching) as watching,
      coalesce(max(u.locale), 'en') as locale
    from (
      select w.user_id, false as answered, true as watching
      from public.page_watch w where w.page_id = new.parent_id
      union all
      select v_answered, true, false where v_answered is not null
    ) who
    join public.user_profile u on u.id = who.user_id
    where who.user_id <> new.author_id
      and exists (
        select 1 from public.organization_membership om
        where om.user_id = who.user_id
          and om.organization_id = new.organization_id
          and om.status = 'active'
      )
    group by who.user_id
  loop
    if not app.person_can_read_comment_parent(r.user_id, 'page', new.parent_id) then
      continue;
    end if;
    insert into public.notification (
      user_id, organization_id, category, title, body, source_type, source_id,
      link, urgency, dedupe_key, reason, context
    ) values (
      r.user_id,
      new.organization_id,
      case when r.answered then 'comment' else 'watched_page' end,
      case
        when r.locale = 'fr-CA' and r.answered then
          format('%s a répondu à votre commentaire sur « %s »', v_author,
            coalesce(nullif(v_title, ''), 'Sans titre'))
        when r.locale = 'fr-CA' then
          format('%s a commenté « %s »', v_author, coalesce(nullif(v_title, ''), 'Sans titre'))
        when r.answered then
          format('%s replied to your comment on “%s”', v_author, coalesce(nullif(v_title, ''), 'Untitled'))
        else
          format('%s commented on “%s”', v_author, coalesce(nullif(v_title, ''), 'Untitled'))
      end,
      v_snippet,
      'page',
      new.parent_id,
      v_link,
      'normal',
      'page_comment:' || new.id || ':' || r.user_id,
      concat_ws(', ',
        case when r.answered then 'reply' end,
        case when r.watching then 'watching' end),
      v_snippet
    )
    on conflict do nothing;
  end loop;
  return null;
end;
$$;
revoke all on function app.notify_page_comment() from public, anon, authenticated;

create trigger record_comment_notify_page
after insert on public.record_comment
for each row
when (new.parent_type = 'page' and new.deleted_at is null)
execute function app.notify_page_comment();

-- A mention notice about a page comment replaces the watched-page or reply
-- notice the same person got for that comment. It runs only once the mention
-- row is really stored: a mention kept out of the Hub, or one that failed to
-- write, leaves the other notice in place.
create or replace function app.notification_supersede_page_comment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_comment text := substring(new.link from '#comment-([0-9a-fA-F-]{36})$');
begin
  if v_comment is not null then
    delete from public.notification n
    where n.user_id = new.user_id
      and n.dedupe_key = 'page_comment:' || lower(v_comment) || ':' || new.user_id;
  end if;
  return null;
end;
$$;
revoke all on function app.notification_supersede_page_comment() from public, anon, authenticated;

create trigger notification_supersede_page_comment
after insert or update of link on public.notification
for each row
when (new.category = 'mention' and new.source_type = 'page')
execute function app.notification_supersede_page_comment();
