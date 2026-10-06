-- Workspace OS: blueprint designer (V2-2, epic #199, stream S1b).
--
-- A blueprint is a drawing of types, properties and relations, with the
-- lenses, forms and workflows building it will create. People draw it in the
-- designer, an owner or admin approves it, and building applies everything as
-- ONE change set that can be undone.
--
-- The structure tables a build writes to (object_type, property_definition,
-- relation_type, lenses, forms, workflows) belong to streams S1, S4, S6 and
-- S6b and do not exist yet. Until they do, `blueprint_build` is the stand-in:
-- it records the build's change set (the exact list of creates) so the
-- designer, approval and undo work end to end now, and integration replaces
-- the body of blueprint_build / blueprint_undo_build with real writes.
--
-- Access: reading needs staff in the blueprint's organization; every write
-- needs owner or admin with two-step sign-in (app.is_org_admin), because a
-- build changes the workspace's structure (the `edit_structure` capability).
-- Nothing is written directly through the API except drafts; approval, build
-- and undo go through the security definer functions below.

create table public.blueprint (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,47}$'),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 120),
  name_fr text not null check (char_length(btrim(name_fr)) between 1 and 120),
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and pg_column_size(definition) <= 262144),
  status text not null default 'draft' check (status in ('draft', 'approved', 'built')),
  approved_hash text,
  approved_by uuid references public.user_profile (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key),
  constraint blueprint_approval_complete check (
    (status = 'draft') = (approved_hash is null and approved_at is null)
  )
);

create index blueprint_org_updated_idx on public.blueprint (organization_id, updated_at desc);

comment on table public.blueprint is
  'Workspace OS blueprints (V2-2): drawn types, properties and relations, approved then built as one change set.';

create table public.blueprint_build (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  blueprint_id uuid not null references public.blueprint (id) on delete cascade,
  change_set_id uuid not null unique default gen_random_uuid(),
  changes jsonb not null check (jsonb_typeof(changes) = 'array'),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  built_by uuid references public.user_profile (id) on delete set null,
  built_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.user_profile (id) on delete set null,
  undo_change_set_id uuid unique,
  constraint blueprint_build_undo_complete check ((undone_at is null) = (undo_change_set_id is null))
);

create index blueprint_build_blueprint_idx on public.blueprint_build (blueprint_id, built_at desc);
create index blueprint_build_org_idx on public.blueprint_build (organization_id, built_at desc);
-- At most one live build per blueprint.
create unique index blueprint_build_one_live on public.blueprint_build (blueprint_id) where undone_at is null;

comment on table public.blueprint_build is
  'Stand-in change set for a blueprint build until the structure tables exist (S1). Written only by blueprint_build / blueprint_undo_build.';

-- ---------------------------------------------------------------------------
-- Editing an approved blueprint sends it back to draft; a built one is locked
-- until its build is undone. Status and approval columns change only through
-- the functions below (column grants), so this trigger only has to react.
-- ---------------------------------------------------------------------------
create or replace function app.blueprint_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.definition is distinct from old.definition
     or new.key is distinct from old.key then
    if old.status = 'built' then
      raise exception 'A built blueprint cannot change until its build is undone.'
        using errcode = 'check_violation';
    end if;
    if old.status = 'approved' and new.status = 'approved' then
      new.status := 'draft';
      new.approved_hash := null;
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), old.updated_by);
  return new;
end;
$$;

create trigger blueprint_before_update
before update on public.blueprint
for each row execute function app.blueprint_before_update();

create or replace function app.blueprint_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'built' then
    raise exception 'Undo the build before deleting this blueprint.' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger blueprint_before_delete
before delete on public.blueprint
for each row execute function app.blueprint_before_delete();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.blueprint enable row level security;
alter table public.blueprint_build enable row level security;

create policy blueprint_read on public.blueprint
for select to authenticated using (app.is_org_staff(organization_id));

create policy blueprint_admin_insert on public.blueprint
for insert to authenticated with check (app.is_org_admin(organization_id) and status = 'draft');

create policy blueprint_admin_update on public.blueprint
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));

create policy blueprint_admin_delete on public.blueprint
for delete to authenticated using (app.is_org_admin(organization_id));

create policy blueprint_build_read on public.blueprint_build
for select to authenticated using (app.is_org_staff(organization_id));

revoke all on public.blueprint, public.blueprint_build from anon, authenticated;
grant select, delete on public.blueprint to authenticated;
grant insert (organization_id, key, name_en, name_fr, definition) on public.blueprint to authenticated;
grant update (key, name_en, name_fr, definition) on public.blueprint to authenticated;
grant select on public.blueprint_build to authenticated;
grant all on public.blueprint, public.blueprint_build to service_role;

-- ---------------------------------------------------------------------------
-- Approve, build and undo
-- ---------------------------------------------------------------------------

-- Approves a draft exactly as it stands; any later edit sends it back to draft.
create or replace function public.blueprint_approve(p_blueprint uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.blueprint;
begin
  select * into v_row from public.blueprint where id = p_blueprint for update;
  if not found or not app.is_org_admin(v_row.organization_id) then
    raise exception 'Only an owner or admin can approve a blueprint.' using errcode = 'insufficient_privilege';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Only a draft can be approved.' using errcode = 'check_violation';
  end if;
  update public.blueprint
  set status = 'approved',
      approved_hash = md5(v_row.definition::text),
      approved_by = (select auth.uid()),
      approved_at = now()
  where id = p_blueprint;
end;
$$;

-- Builds an approved blueprint as one change set. `p_changes` is the plan the
-- application made from the approved definition (src/features/blueprints/plan.ts):
-- a list of `create` changes, each tagged with this blueprint's key. Returns
-- the build's change set id.
create or replace function public.blueprint_build(p_blueprint uuid, p_changes jsonb, p_counts jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.blueprint;
  v_change_set uuid;
  v_clash text;
begin
  select * into v_row from public.blueprint where id = p_blueprint for update;
  if not found or not app.is_org_admin(v_row.organization_id) then
    raise exception 'Only an owner or admin can build a blueprint.' using errcode = 'insufficient_privilege';
  end if;
  if v_row.status <> 'approved' or v_row.approved_hash is distinct from md5(v_row.definition::text) then
    raise exception 'Approve the blueprint before building it.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0
     or jsonb_typeof(coalesce(p_counts, 'null'::jsonb)) <> 'object' then
    raise exception 'A build needs a list of changes.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_changes) c
    where c->>'kind' is distinct from 'create'
       or c#>>'{object,type}' not in ('object_type', 'property_definition', 'relation_type', 'lens', 'form', 'workflow')
       or c#>>'{values,blueprint_key}' is distinct from v_row.key
  ) then
    raise exception 'A build can only create structure from this blueprint.' using errcode = 'invalid_parameter_value';
  end if;

  -- Stand-in for object_type's and relation_type's unique keys: no two live
  -- builds in one organization may create the same type or relation key.
  select c#>>'{values,key}' into v_clash
  from jsonb_array_elements(p_changes) c
  where c#>>'{object,type}' in ('object_type', 'relation_type')
    and exists (
      select 1
      from public.blueprint_build b
      cross join lateral jsonb_array_elements(b.changes) e
      where b.organization_id = v_row.organization_id
        and b.undone_at is null
        and e#>>'{object,type}' = c#>>'{object,type}'
        and e#>>'{values,key}' = c#>>'{values,key}'
    )
  limit 1;
  if v_clash is not null then
    raise exception 'The workspace already has "%".', v_clash using errcode = 'unique_violation';
  end if;

  insert into public.blueprint_build (organization_id, blueprint_id, changes, counts, built_by)
  values (v_row.organization_id, v_row.id, p_changes, p_counts, (select auth.uid()))
  returning change_set_id into v_change_set;

  update public.blueprint set status = 'built' where id = v_row.id;
  return v_change_set;
end;
$$;

-- Undoes a build within 30 days (the trash window, plan A8). The blueprint goes
-- back to draft so it can be changed and approved again. Returns the undo's
-- change set id.
create or replace function public.blueprint_undo_build(p_change_set uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_build public.blueprint_build;
  v_undo uuid := gen_random_uuid();
begin
  select * into v_build from public.blueprint_build where change_set_id = p_change_set for update;
  if not found or not app.is_org_admin(v_build.organization_id) then
    raise exception 'Only an owner or admin can undo a build.' using errcode = 'insufficient_privilege';
  end if;
  if v_build.undone_at is not null then
    raise exception 'This build was already undone.' using errcode = 'check_violation';
  end if;
  if v_build.built_at < now() - interval '30 days' then
    raise exception 'Builds can be undone for 30 days.' using errcode = 'check_violation';
  end if;

  update public.blueprint_build
  set undone_at = now(), undone_by = (select auth.uid()), undo_change_set_id = v_undo
  where id = v_build.id;
  update public.blueprint
  set status = 'draft', approved_hash = null, approved_by = null, approved_at = null
  where id = v_build.blueprint_id;
  return v_undo;
end;
$$;

revoke all on function public.blueprint_approve(uuid) from public, anon;
revoke all on function public.blueprint_build(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.blueprint_undo_build(uuid) from public, anon;
revoke all on function app.blueprint_before_update() from public, anon, authenticated;
revoke all on function app.blueprint_before_delete() from public, anon, authenticated;
grant execute on function public.blueprint_approve(uuid) to authenticated, service_role;
grant execute on function public.blueprint_build(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.blueprint_undo_build(uuid) to authenticated, service_role;
