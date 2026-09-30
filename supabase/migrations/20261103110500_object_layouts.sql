-- Workspace OS V2-4: custom object layouts (epic #199, stream S3b).
--
-- Each object type can have one layout: which properties show on its page
-- and in what order, which related lists appear, and where the content
-- (blocks), comments and version history sit. It is presentation only: a
-- layout never grants anything, and every value it shows is still read
-- under the viewer's own permissions (a hidden property is not a private
-- one; property privacy is M10e).
--
-- The layout is JSON checked in the application (src/features/object-layouts
-- /layout.ts); the database keeps it bounded and well-formed. Members read
-- their organization's layouts; owners and admins (with two-step sign-in,
-- through app.is_org_admin) write them, as they manage custom types.

create table if not exists public.object_layout (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  type_id uuid not null,
  layout jsonb not null,
  updated_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A layout belongs to a type of its own organization.
  foreign key (type_id, organization_id)
    references public.object_type (id, organization_id) on delete cascade,
  unique (type_id),
  constraint object_layout_shape check (
    jsonb_typeof(layout) = 'object'
    and (layout ->> 'version') = '1'
    and jsonb_typeof(layout -> 'sections') = 'array'
    and jsonb_array_length(layout -> 'sections') <= 30
  ),
  constraint object_layout_size check (pg_column_size(layout) < 65536)
);

alter table public.object_layout enable row level security;

drop policy if exists object_layout_read on public.object_layout;
create policy object_layout_read on public.object_layout
  for select to authenticated
  using (app.is_org_member(organization_id));

drop policy if exists object_layout_admin_insert on public.object_layout;
create policy object_layout_admin_insert on public.object_layout
  for insert to authenticated
  with check (app.is_org_admin(organization_id));

drop policy if exists object_layout_admin_update on public.object_layout;
create policy object_layout_admin_update on public.object_layout
  for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

drop policy if exists object_layout_admin_delete on public.object_layout;
create policy object_layout_admin_delete on public.object_layout
  for delete to authenticated
  using (app.is_org_admin(organization_id));

revoke all on public.object_layout from anon;
grant select, insert, update, delete on public.object_layout to authenticated;

-- Who changed it and when are stamped here, not trusted from the caller;
-- the type and organization never move.
create or replace function app.stamp_object_layout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.type_id is distinct from old.type_id
                           or new.organization_id is distinct from old.organization_id) then
    raise exception 'A layout stays with its type.' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function app.stamp_object_layout() from public, anon, authenticated;

drop trigger if exists object_layout_stamp on public.object_layout;
create trigger object_layout_stamp
  before insert or update on public.object_layout
  for each row execute function app.stamp_object_layout();

comment on table public.object_layout is
  'Workspace OS V2-4: which properties, related lists and blocks show on an object type''s page. Presentation only.';
