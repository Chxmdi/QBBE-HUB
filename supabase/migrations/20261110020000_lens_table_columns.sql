-- Workspace OS wave 2, unit D2: spreadsheet-style table columns.
--
-- Two small tables:
--
--   lens_column_setting  an organization's own name for a table column and
--                        whether the column is hidden from everyone's table.
--                        Owners and admins (two-step sign-in) write it; every
--                        member reads it. "Adding" a column back is setting
--                        hidden to false. It never changes what rows anyone
--                        can read: row-level security on the type's own table
--                        still decides that, and a hidden column can still be
--                        filtered on.
--   lens_totals_setting  one viewer's choice of total per column of a type's
--                        table (count, empty, filled, sum, average, minimum,
--                        maximum, or none). A row belongs to its viewer only.
--
-- Both name only types and properties the lens engine knows
-- (public.lens_catalog()); a trigger refuses anything else.
--
-- Add-only and reversible:
--   drop table public.lens_totals_setting; drop table public.lens_column_setting;
--   drop function app.lens_table_setting_guard();

create table public.lens_column_setting (
  organization_id uuid not null references public.organization (id) on delete cascade,
  type_key text not null check (type_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  property_key text not null check (property_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  -- null: the catalog's own name.
  name_en text check (name_en is null or (btrim(name_en) <> '' and char_length(name_en) <= 80)),
  name_fr text check (name_fr is null or (btrim(name_fr) <> '' and char_length(name_fr) <= 80)),
  hidden boolean not null default false,
  updated_by uuid references public.user_profile (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, type_key, property_key),
  -- Every table keeps its title column.
  constraint lens_column_setting_title_shown check (not (property_key = 'title' and hidden))
);

create table public.lens_totals_setting (
  user_id uuid not null references public.user_profile (id) on delete cascade,
  type_key text not null check (type_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  -- { "<property key>": "count" | "count_empty" | "count_filled" | "sum" | "avg" | "min" | "max" | "none" }
  choices jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, type_key),
  constraint lens_totals_setting_shape check (
    jsonb_typeof(choices) = 'object'
    and octet_length(choices::text) <= 4096
    and not jsonb_path_exists(choices, '$.* ? (@.type() != "string")')
    and not jsonb_path_exists(choices,
      '$.* ? (!(@ == "count" || @ == "count_empty" || @ == "count_filled" || @ == "sum" || @ == "avg" || @ == "min" || @ == "max" || @ == "none"))')
  )
);

create index lens_totals_setting_type_idx on public.lens_totals_setting (type_key);

-- Only types and properties the engine knows; the owner columns never move.
create or replace function app.lens_table_setting_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type jsonb := public.lens_catalog() -> new.type_key;
  v_key text;
begin
  if v_type is null then
    raise exception 'Unknown table type.' using errcode = '23514';
  end if;
  if tg_table_name = 'lens_column_setting' then
    if not exists (
      select 1 from jsonb_array_elements(v_type -> 'properties') p
      where p ->> 'key' = new.property_key and not coalesce((p ->> 'filterOnly')::boolean, false)
    ) then
      raise exception 'Unknown column.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and (new.organization_id is distinct from old.organization_id
        or new.type_key is distinct from old.type_key or new.property_key is distinct from old.property_key) then
      raise exception 'A column setting keeps its organization, type and column.' using errcode = '42501';
    end if;
    new.updated_by := (select auth.uid());
  else
    for v_key in select jsonb_object_keys(new.choices) loop
      if not exists (
        select 1 from jsonb_array_elements(v_type -> 'properties') p
        where p ->> 'key' = v_key and not coalesce((p ->> 'filterOnly')::boolean, false)
      ) then
        raise exception 'Unknown column.' using errcode = '23514';
      end if;
    end loop;
    if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.type_key is distinct from old.type_key) then
      raise exception 'A totals setting keeps its viewer and type.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.lens_table_setting_guard() from public, anon, authenticated;

create trigger lens_column_setting_guard
  before insert or update on public.lens_column_setting
  for each row execute function app.lens_table_setting_guard();

create trigger lens_totals_setting_guard
  before insert or update on public.lens_totals_setting
  for each row execute function app.lens_table_setting_guard();

alter table public.lens_column_setting enable row level security;
alter table public.lens_totals_setting enable row level security;

create policy lens_column_setting_read on public.lens_column_setting
  for select to authenticated
  using (app.is_org_member(organization_id));

create policy lens_column_setting_admin_insert on public.lens_column_setting
  for insert to authenticated
  with check (app.is_org_admin(organization_id));

create policy lens_column_setting_admin_update on public.lens_column_setting
  for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

create policy lens_column_setting_admin_delete on public.lens_column_setting
  for delete to authenticated
  using (app.is_org_admin(organization_id));

create policy lens_totals_setting_own_read on public.lens_totals_setting
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy lens_totals_setting_own_insert on public.lens_totals_setting
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy lens_totals_setting_own_update on public.lens_totals_setting
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy lens_totals_setting_own_delete on public.lens_totals_setting
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.lens_column_setting from anon;
revoke all on public.lens_totals_setting from anon;
grant select, insert, update, delete on public.lens_column_setting to authenticated;
grant select, insert, update, delete on public.lens_totals_setting to authenticated;
grant all on public.lens_column_setting to service_role;
grant all on public.lens_totals_setting to service_role;

comment on table public.lens_column_setting is
  'Workspace OS (D2): an organization''s own names for table columns, and columns hidden from everyone''s table. Admins write; members read.';
comment on table public.lens_totals_setting is
  'Workspace OS (D2): one viewer''s choice of total per column of a type''s table.';
