-- Capture inbox (M18, epic #199): a personal inbox for things caught quickly
-- (a thought, a link, a file, a photo of a whiteboard, a forwarded email) to
-- be filed later as a task, a document or a contact interaction.
--
-- An inbox is personal: only its owner reads or changes its items, like a
-- notebook. Filing goes through the target's own action (the shared
-- create-task action, the document commands, the CRM commands), each with
-- its own rules, so the inbox never widens what anyone can create or see.
--
-- Files and photos are uploaded to the existing `documents` bucket at a random
-- path, exactly as the document library does. Storage lets nobody read an
-- object until a document row names it, so a captured file stays unreadable
-- (including to its owner) until it is filed as a document, which also puts it
-- through the existing virus scan. Photo text is read on the device before
-- upload and kept in `body`.

create table if not exists public.capture_item (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  owner_id uuid not null references public.user_profile (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  email_from text,
  email_subject text,
  status text not null default 'inbox',
  filed_as text,
  filed_ref_id uuid,
  filed_project_id uuid references public.project (id) on delete set null,
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_item_kind_check check (kind in ('text', 'link', 'file', 'photo', 'email')),
  constraint capture_item_title_check check (length(btrim(title)) between 1 and 300),
  constraint capture_item_body_check check (body is null or length(body) <= 20000),
  constraint capture_item_url_check check (url is null or (url ~* '^https?://' and length(url) <= 2000)),
  constraint capture_item_link_has_url check (kind <> 'link' or url is not null),
  constraint capture_item_file_has_path check (kind not in ('file', 'photo') or storage_path is not null),
  constraint capture_item_status_check check (status in ('inbox', 'filed', 'dismissed')),
  constraint capture_item_filed_as_check check (filed_as is null or filed_as in ('task', 'document', 'interaction')),
  constraint capture_item_filed_consistent check (
    (status = 'filed') = (filed_as is not null and filed_at is not null)
  )
);

create index if not exists idx_capture_item_owner_inbox
  on public.capture_item (owner_id, status, created_at desc);

comment on table public.capture_item is
  'Personal capture inbox (M18). Owner only; filed through the target''s own action.';

alter table public.capture_item enable row level security;

drop policy if exists capture_item_owner_read on public.capture_item;
create policy capture_item_owner_read on public.capture_item
  for select to authenticated
  using (owner_id = (select auth.uid()) and app.is_org_member(organization_id));

drop policy if exists capture_item_owner_insert on public.capture_item;
create policy capture_item_owner_insert on public.capture_item
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and app.is_org_member(organization_id)
    and status = 'inbox'
  );

drop policy if exists capture_item_owner_update on public.capture_item;
create policy capture_item_owner_update on public.capture_item
  for update to authenticated
  using (owner_id = (select auth.uid()) and app.is_org_member(organization_id))
  with check (owner_id = (select auth.uid()) and app.is_org_member(organization_id));

drop policy if exists capture_item_owner_delete on public.capture_item;
create policy capture_item_owner_delete on public.capture_item
  for delete to authenticated
  using (owner_id = (select auth.uid()) and app.is_org_member(organization_id));

revoke all on public.capture_item from anon;

-- What was captured is fixed; an update may only file or dismiss it.
create or replace function app.capture_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.owner_id is distinct from old.owner_id
     or new.kind is distinct from old.kind
     or new.storage_path is distinct from old.storage_path
     or new.created_at is distinct from old.created_at then
    raise exception 'A captured item''s origin cannot change' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app.capture_item_guard() from public, anon, authenticated;

drop trigger if exists capture_item_guard on public.capture_item;
create trigger capture_item_guard
  before update on public.capture_item
  for each row execute function app.capture_item_guard();

-- Tasks filed from the inbox name it as their source (M7b).
comment on column public.task.source_id is
  'The row the task came from, of the kind named by source_type (capture: capture_item). Null for manual and command tasks.';
