-- Workspace OS view engine UI (wave 1, U13): per-viewer settings on a lens.
--
-- A shared lens is one question everyone looks at. When someone who did not
-- make it narrows the filters, sorts a column or hides a few columns, that
-- must not change the lens for everybody else, and it must still be there
-- when they come back. This table holds that: one row per lens and viewer,
-- with the viewer's own layout (columns), sort keys and where clause.
--
-- Access: a row belongs to its viewer, and exists only for a lens the viewer
-- can read (their own, or one shared in their organization). The lens's own
-- RLS decides that second half, because the policies below select from
-- public.lens as the caller. A lens made personal again hides its viewers'
-- rows at once; a deleted lens takes them with it.
--
-- Add-only and reversible: `drop table public.lens_viewer_setting;` undoes it.

create table public.lens_viewer_setting (
  lens_id uuid not null references public.lens (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object'),
  sort jsonb not null default '[]'::jsonb check (jsonb_typeof(sort) = 'array' and jsonb_array_length(sort) <= 3),
  "where" jsonb check ("where" is null or jsonb_typeof("where") = 'object'),
  updated_at timestamptz not null default now(),
  primary key (lens_id, user_id),
  -- A setting is a few columns and a filter, never a document: cap it so a
  -- runaway client cannot fill the table.
  constraint lens_viewer_setting_size check (
    octet_length(layout::text) <= 16384
    and octet_length(sort::text) <= 1024
    and ("where" is null or octet_length("where"::text) <= 32768)
  )
);

create index lens_viewer_setting_user_idx on public.lens_viewer_setting (user_id);

alter table public.lens_viewer_setting enable row level security;

-- The lens must be readable by the caller: lens_read decides, as the caller.
create policy lens_viewer_setting_read on public.lens_viewer_setting
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.lens l where l.id = lens_id)
  );

create policy lens_viewer_setting_insert on public.lens_viewer_setting
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.lens l where l.id = lens_id)
  );

create policy lens_viewer_setting_update on public.lens_viewer_setting
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.lens l where l.id = lens_id)
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.lens l where l.id = lens_id)
  );

create policy lens_viewer_setting_delete on public.lens_viewer_setting
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.lens_viewer_setting from anon;
grant select, insert, update, delete on public.lens_viewer_setting to authenticated;
grant all on public.lens_viewer_setting to service_role;

-- The lens and the viewer never change after insert; updated_at follows
-- every change.
create or replace function app.lens_viewer_setting_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lens_id is distinct from old.lens_id or new.user_id is distinct from old.user_id then
    raise exception 'A viewer setting keeps its lens and its viewer.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger lens_viewer_setting_guard
  before update on public.lens_viewer_setting
  for each row execute function app.lens_viewer_setting_guard();

revoke all on function app.lens_viewer_setting_guard() from public, anon, authenticated;

comment on table public.lens_viewer_setting is
  'Workspace OS (U13): one viewer''s own columns, sort and filters on a lens they can read. '
  'Never changes the lens itself.';
