-- Workspace OS M11: comments and mentions on any object and any block
-- (epic #199, stream S3b).
--
-- Builds on record_comment rather than a second comment system:
--
--   * A new parent type, `object`, for anything in the object registry that
--     has no comment parent type of its own (pages, custom types). Its access
--     is the one Workspace OS check: reading needs app.can(object, 'view'),
--     posting and reacting need app.can(object, 'comment'). Native records
--     (task, project, meeting…) keep their own parent type and rules, so one
--     record never has two threads.
--   * `block_id` pins a comment to one block of the object's content, by the
--     editor's block id. Blocks are rows derived from the live document
--     (stream S3, M4c); there is no foreign key until that table exists, and
--     the comment's access is always its object's.
--   * Reactions: a fixed set, one of each per person per comment.
--   * Mentions: `@person` and `@object`, recorded per comment so mentioned
--     people are notified once and objects can list where they were mentioned.
--
-- Resolve and reopen already exist (resolved_at, stamped by
-- app.guard_record_comment); nothing here changes that trigger.

-- ---------------------------------------------------------------------------
-- Parent types and block anchor
-- ---------------------------------------------------------------------------

alter table public.record_comment
  drop constraint if exists record_comment_parent_type_check;
alter table public.record_comment
  add constraint record_comment_parent_type_check
  check (parent_type in (
    'project', 'task', 'milestone', 'event', 'meeting', 'agenda_item',
    'risk', 'issue', 'update', 'organization', 'contact', 'opportunity',
    'object'
  ));

-- Block ids are the editor's own (short strings, not necessarily uuids).
alter table public.record_comment
  add column if not exists block_id text;
alter table public.record_comment
  drop constraint if exists record_comment_block_id_shape;
alter table public.record_comment
  add constraint record_comment_block_id_shape
  check (block_id is null or block_id ~ '^[A-Za-z0-9_-]{1,100}$');

create index if not exists idx_record_comment_block
  on public.record_comment (parent_id, block_id)
  where block_id is not null;

-- Same body as 20260912040000 plus the `object` branch.
create or replace function public.can_read_comment_parent(
  p_type text,
  p_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_type
    when 'project' then app.has_project_capability(p_id, 'read')
    when 'task' then app.has_task_capability(p_id, 'read')
    when 'milestone' then exists (
      select 1 from public.milestone m
      where m.id = p_id and app.has_project_capability(m.project_id, 'read')
    )
    when 'event' then app.can_read_event(p_id)
    when 'meeting' then app.can_read_meeting(p_id)
    when 'agenda_item' then exists (
      select 1 from public.agenda_item a
      where a.id = p_id and app.can_read_meeting(a.meeting_id)
    )
    when 'risk' then exists (
      select 1 from public.risk r
      where r.id = p_id and app.has_project_capability(r.project_id, 'read')
    )
    when 'issue' then exists (
      select 1 from public.issue i
      where i.id = p_id and app.has_project_capability(i.project_id, 'read')
    )
    when 'update' then exists (
      select 1 from public.project_status_update u
      where u.id = p_id and app.has_project_capability(u.project_id, 'read')
    )
    when 'organization' then app.can_access_crm((
      select c.organization_id from public.crm_organization c where c.id = p_id
    ))
    when 'contact' then app.can_access_crm((
      select c.organization_id from public.crm_contact c where c.id = p_id
    ))
    when 'opportunity' then app.can_access_crm((
      select o.organization_id from public.opportunity o where o.id = p_id
    ))
    when 'object' then app.can(p_id, 'view')
    else false
  end;
$$;

-- Posting: the existing parent types keep "anyone who can read may comment";
-- an `object` needs the comment capability, which viewers may not have.
create or replace function public.can_post_comment(p_type text, p_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_type
    when 'object' then app.can(p_id, 'comment')
    else public.can_read_comment_parent(p_type, p_id)
  end;
$$;

revoke all on function public.can_post_comment(text, uuid) from public, anon;
grant execute on function public.can_post_comment(text, uuid)
  to authenticated, service_role;

drop policy if exists record_comment_insert on public.record_comment;
create policy record_comment_insert on public.record_comment for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_post_comment(parent_type, parent_id)
  );

-- The comment's organization must be the object's. Native parents are checked
-- by their own predicates; an `object` id says nothing about its organization
-- until the registry lands, so the author's active membership is required.
create or replace function app.guard_object_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.block_id is distinct from old.block_id then
    raise exception 'The block a comment is pinned to cannot change.'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (select auth.uid()) is not null
     and not app.is_org_member(new.organization_id) then
    raise exception 'Comments are posted in your own organization.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_object_comment() from public, anon, authenticated;

drop trigger if exists record_comment_object_guard on public.record_comment;
create trigger record_comment_object_guard
  before insert or update on public.record_comment
  for each row execute function app.guard_object_comment();

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

create table if not exists public.record_comment_reaction (
  comment_id uuid not null references public.record_comment (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade
    default auth.uid(),
  reaction text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, reaction),
  constraint record_comment_reaction_is_known
    check (reaction in ('thumbs_up', 'heart', 'celebrate', 'eyes', 'done', 'thanks'))
);

create index if not exists idx_record_comment_reaction_user
  on public.record_comment_reaction (user_id);

alter table public.record_comment_reaction enable row level security;

-- Whether the signed-in person may react to (or be told about) a comment:
-- the comment is live and they may post on its parent.
create or replace function app.can_react_to_comment(p_comment uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.record_comment c
    where c.id = p_comment
      and c.deleted_at is null
      and app.is_org_member(c.organization_id)
      and public.can_post_comment(c.parent_type, c.parent_id)
  );
$$;

create or replace function public.can_react_to_comment(p_comment uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.can_react_to_comment(p_comment);
$$;

revoke all on function app.can_react_to_comment(uuid) from public, anon, authenticated;
revoke all on function public.can_react_to_comment(uuid) from public, anon;
grant execute on function public.can_react_to_comment(uuid) to authenticated, service_role;

-- The reaction's organization is always its comment's.
create or replace function app.stamp_comment_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.organization_id into new.organization_id
  from public.record_comment c where c.id = new.comment_id;
  return new;
end;
$$;

revoke all on function app.stamp_comment_reaction() from public, anon, authenticated;

drop trigger if exists record_comment_reaction_stamp on public.record_comment_reaction;
create trigger record_comment_reaction_stamp
  before insert on public.record_comment_reaction
  for each row execute function app.stamp_comment_reaction();

-- Visible exactly when the comment is: the subquery runs under the reader's
-- own record_comment policy.
drop policy if exists record_comment_reaction_read on public.record_comment_reaction;
create policy record_comment_reaction_read on public.record_comment_reaction
  for select to authenticated
  using (exists (select 1 from public.record_comment c where c.id = comment_id));

drop policy if exists record_comment_reaction_insert on public.record_comment_reaction;
create policy record_comment_reaction_insert on public.record_comment_reaction
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_react_to_comment(comment_id)
  );

-- Taking a reaction back is always allowed to its owner.
drop policy if exists record_comment_reaction_delete on public.record_comment_reaction;
create policy record_comment_reaction_delete on public.record_comment_reaction
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.record_comment_reaction from anon;
grant select, insert, delete on public.record_comment_reaction to authenticated;

-- ---------------------------------------------------------------------------
-- Mentions
-- ---------------------------------------------------------------------------

create table if not exists public.record_comment_mention (
  comment_id uuid not null references public.record_comment (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  target_kind text not null,
  target_id uuid not null,
  -- Set on person mentions when the person was notified (they could read the
  -- parent at the time); null means they were not told.
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (comment_id, target_kind, target_id),
  constraint record_comment_mention_kind_is_known
    check (target_kind in ('person', 'object'))
);

create index if not exists idx_record_comment_mention_target
  on public.record_comment_mention (target_kind, target_id);

alter table public.record_comment_mention enable row level security;

-- A mention is visible when its comment is. An object mention also needs the
-- reader to see the mentioned object, so "where was this mentioned" never
-- reveals an object the reader cannot open.
drop policy if exists record_comment_mention_read on public.record_comment_mention;
create policy record_comment_mention_read on public.record_comment_mention
  for select to authenticated
  using (
    exists (select 1 from public.record_comment c where c.id = comment_id)
    and (target_kind = 'person' or public.can(target_id, 'view'))
  );

-- Written only by public.set_comment_mentions below.
revoke all on public.record_comment_mention from anon, authenticated;
grant select on public.record_comment_mention to authenticated;

-- Whether a given person could read a comment parent. The access predicates
-- all ask about the signed-in user, so this answers as that person: it swaps
-- the request's claims for the duration of one call and restores them. The
-- person is evaluated at the lowest assurance level (reading never needs
-- AAL2). Contract addition: stream S2 may replace this with a native
-- app.can_as(user, object, capability).
create or replace function app.person_can_read_comment_parent(
  p_user uuid,
  p_type text,
  p_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v_result boolean;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1'
  )::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    v_result := coalesce(public.can_read_comment_parent(p_type, p_id), false);
  exception when others then
    v_result := false;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  return v_result;
end;
$$;

revoke all on function app.person_can_read_comment_parent(uuid, text, uuid)
  from public, anon, authenticated;

-- Records a comment's mentions and returns the people to notify.
--
-- Only the comment's author calls it, right after posting or editing. A
-- person is recorded only if they are an active member of the comment's
-- organization, and returned for notification only the first time they are
-- mentioned in that comment and only if they can read its parent, so a
-- mention never tells anyone about a record they cannot open. An object is
-- recorded only if the author can see it. Mentions dropped from an edit are
-- removed.
create or replace function public.set_comment_mentions(
  p_comment uuid,
  p_people uuid[],
  p_objects uuid[]
)
returns setof uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_comment public.record_comment%rowtype;
  v_person uuid;
  v_object uuid;
  v_people uuid[] := coalesce(p_people, array[]::uuid[]);
  v_objects uuid[] := coalesce(p_objects, array[]::uuid[]);
begin
  if v_actor is null then
    raise exception 'Sign in to mention people.' using errcode = '42501';
  end if;
  if cardinality(v_people) > 20 or cardinality(v_objects) > 20 then
    raise exception 'A comment can mention at most 20 people and 20 objects.'
      using errcode = 'check_violation';
  end if;

  select * into v_comment from public.record_comment c where c.id = p_comment;
  if not found or v_comment.author_id <> v_actor or v_comment.deleted_at is not null
     or not app.is_org_member(v_comment.organization_id) then
    raise exception 'Only the author of a live comment can set its mentions.'
      using errcode = '42501';
  end if;

  delete from public.record_comment_mention m
  where m.comment_id = p_comment
    and ((m.target_kind = 'person' and not (m.target_id = any (v_people)))
      or (m.target_kind = 'object' and not (m.target_id = any (v_objects))));

  foreach v_object in array v_objects loop
    if app.can(v_object, 'view') then
      insert into public.record_comment_mention (comment_id, organization_id, target_kind, target_id)
      values (p_comment, v_comment.organization_id, 'object', v_object)
      on conflict do nothing;
    end if;
  end loop;

  foreach v_person in array v_people loop
    if v_person = v_actor or not exists (
      select 1 from public.organization_membership om
      where om.user_id = v_person
        and om.organization_id = v_comment.organization_id
        and om.status = 'active'
    ) then
      continue;
    end if;
    if exists (
      select 1 from public.record_comment_mention m
      where m.comment_id = p_comment and m.target_kind = 'person' and m.target_id = v_person
    ) then
      continue;
    end if;
    if app.person_can_read_comment_parent(v_person, v_comment.parent_type, v_comment.parent_id) then
      insert into public.record_comment_mention
        (comment_id, organization_id, target_kind, target_id, notified_at)
      values (p_comment, v_comment.organization_id, 'person', v_person, now());
      return next v_person;
    else
      insert into public.record_comment_mention
        (comment_id, organization_id, target_kind, target_id)
      values (p_comment, v_comment.organization_id, 'person', v_person);
    end if;
  end loop;
  return;
end;
$$;

revoke all on function public.set_comment_mentions(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.set_comment_mentions(uuid, uuid[], uuid[])
  to authenticated, service_role;

comment on table public.record_comment_reaction is
  'Workspace OS M11: reactions on comments, one of each kind per person.';
comment on table public.record_comment_mention is
  'Workspace OS M11: @person and @object mentions per comment, written by set_comment_mentions.';
