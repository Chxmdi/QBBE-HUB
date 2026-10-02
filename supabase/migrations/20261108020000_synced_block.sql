-- Workspace OS synced blocks (U5b, plan A4, switch wos_editor).
--
-- A synced block is a group of blocks kept in one place and shown on several
-- pages. Its content lives here, once; the page it was made on holds a
-- `syncedBlock` block with role "source", and every other page that shows it
-- holds one with role "copy". Editing the source writes through to this row,
-- so every copy shows the edit the next time it loads.
--
-- Access follows the source document, through the same rule as its body
-- (app.can_editor_object): reading needs `view` on the source, writing needs
-- `edit_content` on it. A copy on a page someone can open does not open the
-- source to them: they see a request-access state and may ask. Someone who
-- can edit the source decides; a granted request lets that one person read
-- this one synced block, nothing else of the source.

create table public.synced_block (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  source_object_id uuid not null,
  source_object_type text not null check (source_object_type in ('page', 'task', 'meeting')),
  source_block_id text not null check (char_length(source_block_id) between 1 and 100),
  content jsonb not null default '{"version":1,"blocks":[]}'::jsonb
    check (jsonb_typeof(content) = 'object' and jsonb_typeof(content -> 'blocks') = 'array'),
  -- The content as plain text, written with it, for the picker's search.
  content_text text not null default '' check (char_length(content_text) <= 500000),
  created_by uuid not null default auth.uid() references public.user_profile (id),
  updated_by uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint synced_block_size check (pg_column_size(content) <= 1024 * 1024)
);

comment on table public.synced_block is
  'Synced block content (U5b): an EditorContent fragment shown on several pages, readable as its source document is.';

create index synced_block_org_idx on public.synced_block (organization_id, updated_at desc);
-- Not unique: a source block whose first synced block was undone, or never
-- saved with its page, may make another.
create index synced_block_source_idx on public.synced_block (source_object_id, source_block_id);

create table public.synced_block_access_request (
  id uuid primary key default gen_random_uuid(),
  synced_block_id uuid not null references public.synced_block (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  requester_id uuid not null default auth.uid() references public.user_profile (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'granted', 'declined')),
  decided_by uuid references public.user_profile (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (synced_block_id, requester_id)
);

comment on table public.synced_block_access_request is
  'A request to read one synced block whose source the requester cannot open (U5b).';

create index synced_block_access_request_block_idx on public.synced_block_access_request (synced_block_id, status);

-- Helpers --------------------------------------------------------------------
-- Security definer so the two tables' policies can name each other without
-- recursing through RLS.

create or replace function app.can_synced_source(p_synced_block uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.can_editor_object(s.source_object_type, s.source_object_id, p_capability)
    from public.synced_block s
    where s.id = p_synced_block
  ), false);
$$;

create or replace function app.synced_block_granted(p_synced_block uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.synced_block_access_request r
    join public.synced_block s on s.id = r.synced_block_id
    where r.synced_block_id = p_synced_block
      and r.requester_id = (select auth.uid())
      and r.status = 'granted'
      and app.is_org_member(s.organization_id)
  );
$$;

-- The editor asks this before offering "Edit" on a source block.
create or replace function public.can_edit_synced_block(p_synced_block uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.can_synced_source(p_synced_block, 'edit_content');
$$;

revoke all on function public.can_edit_synced_block(uuid) from public, anon;
grant execute on function public.can_edit_synced_block(uuid) to authenticated, service_role;

revoke all on function app.can_synced_source(uuid, text) from public, anon;
revoke all on function app.synced_block_granted(uuid) from public, anon;
grant execute on function app.can_synced_source(uuid, text) to authenticated, service_role;
grant execute on function app.synced_block_granted(uuid) to authenticated, service_role;

-- The row takes its organization from the source, and never moves to another
-- source; who changed it and when are kept by the database.
create or replace function app.synced_block_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' then
    if new.source_object_id <> old.source_object_id
      or new.source_object_type <> old.source_object_type
      or new.source_block_id <> old.source_block_id then
      raise exception 'A synced block cannot move to another source' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if new.source_object_type = 'page' then
    select p.organization_id into v_org from public.page p where p.id = new.source_object_id;
  elsif new.source_object_type = 'task' then
    select t.organization_id into v_org from public.task t where t.id = new.source_object_id;
  elsif new.source_object_type = 'meeting' then
    select m.organization_id into v_org from public.meeting m where m.id = new.source_object_id;
  end if;
  if v_org is null then
    raise exception 'No such source for this synced block' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by, new.created_by);
  return new;
end;
$$;

revoke all on function app.synced_block_before_write() from public, anon, authenticated;

create trigger synced_block_before_write
  before insert or update on public.synced_block
  for each row execute function app.synced_block_before_write();

-- A request takes its organization from the synced block; only the status
-- changes afterwards, and the database records who decided and when.
create or replace function app.synced_block_access_request_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select s.organization_id into new.organization_id from public.synced_block s where s.id = new.synced_block_id;
    if new.organization_id is null then
      raise exception 'No such synced block' using errcode = '23503';
    end if;
    new.decided_by := null;
    new.decided_at := null;
    new.created_at := now();
    return new;
  end if;
  if new.synced_block_id <> old.synced_block_id
    or new.requester_id <> old.requester_id
    or new.organization_id <> old.organization_id then
    raise exception 'Only a request''s decision can change' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke all on function app.synced_block_access_request_before_write() from public, anon, authenticated;

create trigger synced_block_access_request_before_write
  before insert or update on public.synced_block_access_request
  for each row execute function app.synced_block_access_request_before_write();

-- Row-level security ---------------------------------------------------------

alter table public.synced_block enable row level security;

create policy synced_block_read on public.synced_block
  for select to authenticated
  using (
    app.can_editor_object(source_object_type, source_object_id, 'view')
    or app.synced_block_granted(id)
  );

create policy synced_block_insert on public.synced_block
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.can_editor_object(source_object_type, source_object_id, 'edit_content')
  );

create policy synced_block_update on public.synced_block
  for update to authenticated
  using (app.can_editor_object(source_object_type, source_object_id, 'edit_content'))
  with check (app.can_editor_object(source_object_type, source_object_id, 'edit_content'));

revoke all on public.synced_block from anon, authenticated;
grant select, insert, update on public.synced_block to authenticated;
grant all on public.synced_block to service_role;

alter table public.synced_block_access_request enable row level security;

create policy synced_block_access_request_read on public.synced_block_access_request
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or app.can_synced_source(synced_block_id, 'edit_content')
  );

create policy synced_block_access_request_insert on public.synced_block_access_request
  for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'requested'
    and app.is_org_member(organization_id)
  );

create policy synced_block_access_request_decide on public.synced_block_access_request
  for update to authenticated
  using (app.can_synced_source(synced_block_id, 'edit_content'))
  with check (
    status in ('granted', 'declined')
    and app.can_synced_source(synced_block_id, 'edit_content')
  );

revoke all on public.synced_block_access_request from anon, authenticated;
grant select, insert on public.synced_block_access_request to authenticated;
grant update (status) on public.synced_block_access_request to authenticated;
grant all on public.synced_block_access_request to service_role;
