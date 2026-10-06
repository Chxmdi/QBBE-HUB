-- Workspace OS pages (M4a, stream S3, epic #199).
--
-- A page is an object of type `page` (workspace-os-object-layer.md, A1). The
-- object registry (S1) and spaces (S2) are being built in parallel, so pages
-- keep their own table now and are registered later: `page.id` becomes the
-- `object.id`, exactly as a task's id is its object's id. Nothing here depends
-- on those tables existing.
--
-- Where a page lives, until spaces land:
--   visibility = 'workspace'  the organization's shared pages
--   visibility = 'private'    only the person who created it
-- `space_id` is kept (no foreign key yet) so S2 can move pages into spaces
-- without a table rewrite.
--
-- Who can do what (the stand-in rule, never more open than the rest of the Hub):
--   read a workspace page      owner, admin, leadership viewer, staff
--   read a private page        its creator, while an active member
--   write a workspace page     staff, and owners/admins with two-step sign-in
--                              (app.is_org_staff, so AAL2 is inherited)
--   write a private page       its creator, unless a guest or leadership viewer
-- Volunteers and guests do not see shared pages until S2's grants let a space
-- or page be shared with them. `app.can_page` answers the same question in the
-- `app.can` vocabulary so integration can make app.can delegate to it.
--
-- Deleting is a soft delete (`deleted_at`, the 30-day trash of M16a). The API
-- cannot hard-delete a page.

create table public.page (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  space_id uuid,
  parent_page_id uuid references public.page (id) on delete cascade,
  visibility text not null default 'workspace'
    check (visibility in ('workspace', 'private')),
  title text not null default '' check (char_length(title) <= 500),
  icon text check (icon is null or char_length(icon) between 1 and 32),
  cover text check (cover is null or char_length(cover) between 1 and 200),
  position double precision not null default 0,
  created_by uuid not null default auth.uid() references public.user_profile (id),
  updated_by uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint page_not_own_parent check (parent_page_id is null or parent_page_id <> id)
);

comment on table public.page is
  'Workspace OS pages (M4a). Registered as object type `page` when the object '
  'registry lands; page.id is the object id.';

create index page_org_tree_idx on public.page (organization_id, parent_page_id, position)
  where deleted_at is null;
create index page_parent_idx on public.page (parent_page_id);
create index page_creator_idx on public.page (created_by);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

create or replace function app.can_read_page_row(
  p_organization uuid,
  p_visibility text,
  p_created_by uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_membership m
      where m.organization_id = p_organization
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (
          (p_visibility = 'private' and p_created_by = (select auth.uid()))
          or (
            p_visibility = 'workspace'
            and m.role in ('owner', 'admin', 'leadership_viewer', 'staff')
          )
        )
    );
$$;

create or replace function app.can_write_page_row(
  p_organization uuid,
  p_visibility text,
  p_created_by uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and case p_visibility
      when 'workspace' then app.is_org_staff(p_organization)
      when 'private' then p_created_by = (select auth.uid())
        and exists (
          select 1
          from public.organization_membership m
          where m.organization_id = p_organization
            and m.user_id = (select auth.uid())
            and m.status = 'active'
            and m.role in ('owner', 'admin', 'staff', 'volunteer')
        )
      else false
    end;
$$;

-- The page answer in app.can's vocabulary. Reading needs `view`; every other
-- capability needs write access (pages have no finer roles until S2 grants).
create or replace function app.can_page(page_id uuid, capability text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_page public.page%rowtype;
begin
  if (select auth.uid()) is null or can_page.page_id is null then
    return false;
  end if;
  select * into v_page from public.page p where p.id = can_page.page_id;
  if not found then
    return false;
  end if;
  case lower(coalesce(can_page.capability, ''))
    when 'view', 'read' then
      return app.can_read_page_row(v_page.organization_id, v_page.visibility, v_page.created_by);
    when 'comment', 'edit_content', 'edit_structure', 'manage', 'share', 'run_workflow' then
      return v_page.deleted_at is null
        and app.can_write_page_row(v_page.organization_id, v_page.visibility, v_page.created_by);
    else
      return false;
  end case;
end;
$$;

create or replace function public.can_page(page_id uuid, capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.can_page(page_id, capability);
$$;

revoke all on function app.can_read_page_row(uuid, text, uuid) from public, anon;
revoke all on function app.can_write_page_row(uuid, text, uuid) from public, anon;
revoke all on function app.can_page(uuid, text) from public, anon;
revoke all on function public.can_page(uuid, text) from public, anon;
grant execute on function app.can_read_page_row(uuid, text, uuid) to authenticated, service_role;
grant execute on function app.can_write_page_row(uuid, text, uuid) to authenticated, service_role;
-- Signed-in roles cannot name the app schema; policies reach it by reference.
grant execute on function app.can_page(uuid, text) to authenticated, service_role;
grant execute on function public.can_page(uuid, text) to authenticated, service_role;

comment on function app.can_page(uuid, text) is
  'Workspace OS access check for pages (M4a). app.can should delegate here for '
  'objects of type page once the registry lands.';

alter table public.page enable row level security;

create policy page_read on public.page
  for select to authenticated
  using (app.can_read_page_row(organization_id, visibility, created_by));

create policy page_insert on public.page
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.can_write_page_row(organization_id, visibility, created_by)
  );

create policy page_update on public.page
  for update to authenticated
  using (app.can_write_page_row(organization_id, visibility, created_by))
  with check (app.can_write_page_row(organization_id, visibility, created_by));

-- Supabase's default privileges grant everything; take it back first.
revoke all on public.page from anon, authenticated;
grant select, insert, update on public.page to authenticated;
grant all on public.page to service_role;

-- ---------------------------------------------------------------------------
-- Integrity: organization, nesting, visibility, bookkeeping
-- ---------------------------------------------------------------------------

create or replace function app.page_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_parent public.page%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'A page cannot move to another organization' using errcode = '42501';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'A page''s creator cannot change' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;

  if new.parent_page_id is not null then
    select * into v_parent from public.page p where p.id = new.parent_page_id;
    if not found or v_parent.organization_id <> new.organization_id then
      raise exception 'The parent page is not in this organization' using errcode = '23503';
    end if;
    -- A page lives where its parent lives.
    new.visibility := v_parent.visibility;
    if new.visibility = 'private' and new.created_by <> v_parent.created_by then
      raise exception 'A private page can only hold its owner''s pages' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.parent_page_id is distinct from old.parent_page_id then
      if exists (
        with recursive up as (
          select v_parent.id as id, v_parent.parent_page_id as parent_page_id
          union all
          select p.id, p.parent_page_id
          from public.page p join up on p.id = up.parent_page_id
        )
        select 1 from up where up.id = new.id
      ) then
        raise exception 'A page cannot be moved inside itself' using errcode = '23514';
      end if;
    end if;
  end if;

  -- Making a tree private must not hide other people's pages inside it.
  if tg_op = 'UPDATE' and new.visibility = 'private' and old.visibility <> 'private' then
    if exists (
      with recursive down as (
        select p.id, p.created_by from public.page p where p.parent_page_id = new.id
        union all
        select p.id, p.created_by from public.page p join down on p.parent_page_id = down.id
      )
      select 1 from down where down.created_by <> new.created_by
    ) then
      raise exception 'This page holds pages other people created, so it cannot become private'
        using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

create trigger page_before_write
  before insert or update on public.page
  for each row execute function app.page_before_write();

-- Children follow their parent's visibility when a tree moves between the
-- workspace and a private area. Runs with definer rights because the mover
-- may not be allowed to write each descendant directly; the checks above
-- already decided the move is allowed.
create or replace function app.page_cascade_visibility()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.page p
  set visibility = new.visibility
  where p.parent_page_id = new.id
    and p.visibility <> new.visibility;
  return null;
end;
$$;

-- Not `update of visibility`: a move changes visibility inside the before
-- trigger, which a column list would not see.
create trigger page_cascade_visibility
  after update on public.page
  for each row
  when (old.visibility is distinct from new.visibility)
  execute function app.page_cascade_visibility();

revoke all on function app.page_before_write() from public, anon, authenticated;
revoke all on function app.page_cascade_visibility() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Favourites and recently visited: one row per person and page, own rows only
-- ---------------------------------------------------------------------------

create table public.page_favourite (
  user_id uuid not null default auth.uid() references public.user_profile (id) on delete cascade,
  page_id uuid not null references public.page (id) on delete cascade,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index page_favourite_page_idx on public.page_favourite (page_id);

create table public.page_visit (
  user_id uuid not null default auth.uid() references public.user_profile (id) on delete cascade,
  page_id uuid not null references public.page (id) on delete cascade,
  visited_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index page_visit_recent_idx on public.page_visit (user_id, visited_at desc);
create index page_visit_page_idx on public.page_visit (page_id);

alter table public.page_favourite enable row level security;
alter table public.page_visit enable row level security;

-- A person only sees and changes their own list, and only for pages they can
-- still read: losing access to a page removes it from their lists at once.
create policy page_favourite_own on public.page_favourite
  for all to authenticated
  using (user_id = (select auth.uid()) and app.can_page(page_id, 'view'))
  with check (user_id = (select auth.uid()) and app.can_page(page_id, 'view'));

create policy page_visit_own on public.page_visit
  for all to authenticated
  using (user_id = (select auth.uid()) and app.can_page(page_id, 'view'))
  with check (user_id = (select auth.uid()) and app.can_page(page_id, 'view'));

revoke all on public.page_favourite, public.page_visit from anon, authenticated;
grant select, insert, update, delete on public.page_favourite to authenticated;
grant select, insert, update, delete on public.page_visit to authenticated;
grant all on public.page_favourite, public.page_visit to service_role;
