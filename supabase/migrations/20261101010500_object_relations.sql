-- Workspace OS M3a: relations between objects (epic #199, design note section 5).
--
-- relation_type        named, two-way link kinds ("contains" / "is in"),
--                      seeded per organization; owners and admins add their own.
-- object_relation      links between objects that have no native column.
-- object_relation_all  one view over every link: the rows above plus the links
--                      that already exist as native columns (task.project_id,
--                      task_dependency, crm_link, decision.meeting_id, the
--                      project_id of risks, meetings, events, documents and
--                      decisions). It is security_invoker, so each branch is
--                      filtered by its own table's RLS and nothing is copied.
--
-- A relation type marked is_native only exists through native columns; it
-- cannot be written into object_relation (move a task by changing its
-- project, as today).
--
-- Reading a link needs view on both ends and writing needs edit_content on
-- both, the same rule task_dependency uses today.

-- ---------------------------------------------------------------------------
-- relation_type
-- ---------------------------------------------------------------------------

create table public.relation_type (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name_en text not null check (btrim(name_en) <> ''),
  name_fr text not null check (btrim(name_fr) <> ''),
  reverse_name_en text not null check (btrim(reverse_name_en) <> ''),
  reverse_name_fr text not null check (btrim(reverse_name_fr) <> ''),
  cardinality text not null default 'many_to_many'
    check (cardinality in ('one_to_one', 'one_to_many', 'many_to_many')),
  from_type_id uuid,
  to_type_id uuid,
  is_native boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, key),
  unique (id, organization_id),
  foreign key (from_type_id, organization_id) references public.object_type (id, organization_id),
  foreign key (to_type_id, organization_id) references public.object_type (id, organization_id)
);

comment on table public.relation_type is
  'Workspace OS relation types (M3a). is_native types mirror existing columns and cannot be written into object_relation.';

create trigger relation_type_updated_at before update on public.relation_type
  for each row execute function public.set_updated_at();

alter table public.relation_type enable row level security;

create policy relation_type_read on public.relation_type for select to authenticated
  using (app.is_org_member(organization_id));
create policy relation_type_admin_insert on public.relation_type for insert to authenticated
  with check (not is_native and app.is_org_admin(organization_id));
create policy relation_type_admin_update on public.relation_type for update to authenticated
  using (not is_native and app.is_org_admin(organization_id))
  with check (not is_native and app.is_org_admin(organization_id));

revoke all on public.relation_type from anon;
revoke delete, truncate on public.relation_type from authenticated;

create or replace function app.seed_relation_types(p_organization uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.relation_type
    (organization_id, key, name_en, name_fr, reverse_name_en, reverse_name_fr, cardinality, is_native)
  values
    (p_organization, 'contains', 'Contains', 'Contient', 'Is in', 'Fait partie de', 'one_to_many', true),
    (p_organization, 'blocks', 'Blocks', 'Bloque', 'Is blocked by', 'Est bloqué par', 'many_to_many', true),
    (p_organization, 'decided_in', 'Decided in', 'Décidé lors de', 'Decisions', 'Décisions', 'one_to_many', true),
    (p_organization, 'related_to', 'Related to', 'Lié à', 'Related to', 'Lié à', 'many_to_many', false),
    (p_organization, 'supports', 'Supports', 'Soutient', 'Supported by', 'Soutenu par', 'many_to_many', false),
    (p_organization, 'originated_from', 'Originated from', 'Provient de', 'Led to', 'A mené à', 'many_to_many', false),
    (p_organization, 'applies_for', 'Applies for', 'Demande pour', 'Applications', 'Demandes', 'many_to_many', false),
    (p_organization, 'owns', 'Owns', 'Possède', 'Owned by', 'Appartient à', 'one_to_many', false)
  on conflict (organization_id, key) do nothing;
$$;

revoke all on function app.seed_relation_types(uuid) from public, anon, authenticated;

create or replace function app.seed_native_object_types_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_native_object_types(new.id);
  perform app.seed_system_properties(new.id);
  perform app.seed_relation_types(new.id);
  return new;
end;
$$;

select app.seed_relation_types(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- object_relation
-- ---------------------------------------------------------------------------

create table public.object_relation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  from_id uuid not null references public.object (id) on delete cascade,
  to_id uuid not null references public.object (id) on delete cascade,
  relation_type_id uuid not null,
  position double precision,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (from_id, relation_type_id, to_id),
  check (from_id <> to_id),
  foreign key (relation_type_id, organization_id)
    references public.relation_type (id, organization_id) on delete cascade
);

comment on table public.object_relation is
  'Workspace OS links between objects (M3a). Read with view on both ends, written with edit_content on both.';

create index idx_object_relation_from on public.object_relation (from_id, relation_type_id);
create index idx_object_relation_to on public.object_relation (to_id, relation_type_id);
create index idx_object_relation_type on public.object_relation (relation_type_id);
create index idx_object_relation_org on public.object_relation (organization_id);

-- Both ends in the relation's organization, the type writable and matching
-- the ends' types, and the type's cardinality respected.
create or replace function app.guard_object_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.relation_type;
  v_from public.object;
  v_to public.object;
begin
  select * into v_type from public.relation_type t where t.id = new.relation_type_id;
  select * into v_from from public.object o where o.id = new.from_id;
  select * into v_to from public.object o where o.id = new.to_id;

  if v_from.organization_id is distinct from new.organization_id
    or v_to.organization_id is distinct from new.organization_id then
    raise exception 'Both ends of a relation must be in its organization.' using errcode = '23514';
  end if;
  if v_type.is_native then
    raise exception 'The % relation is changed through its record, not here.', v_type.key using errcode = '23514';
  end if;
  if v_type.archived_at is not null then
    raise exception 'This relation type is archived.' using errcode = '23514';
  end if;
  if (v_type.from_type_id is not null and v_type.from_type_id <> v_from.type_id)
    or (v_type.to_type_id is not null and v_type.to_type_id <> v_to.type_id) then
    raise exception 'This relation does not connect these kinds of object.' using errcode = '23514';
  end if;

  -- Serialize writers of the same type so two concurrent links cannot both
  -- slip past the cardinality check.
  perform pg_advisory_xact_lock(hashtext('object_relation:' || new.relation_type_id::text));

  if v_type.cardinality in ('one_to_many', 'one_to_one') and exists (
    select 1 from public.object_relation r
    where r.relation_type_id = new.relation_type_id and r.to_id = new.to_id and r.id <> new.id
  ) then
    raise exception 'That object already has a "%" link.', v_type.reverse_name_en using errcode = '23505';
  end if;
  if v_type.cardinality = 'one_to_one' and exists (
    select 1 from public.object_relation r
    where r.relation_type_id = new.relation_type_id and r.from_id = new.from_id and r.id <> new.id
  ) then
    raise exception 'That object already has a "%" link.', v_type.name_en using errcode = '23505';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(
      new.created_by,
      (select u.id from public.user_profile u where u.id = (select auth.uid()))
    );
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke all on function app.guard_object_relation() from public, anon, authenticated;

create trigger object_relation_guard
  before insert or update on public.object_relation
  for each row execute function app.guard_object_relation();

alter table public.object_relation enable row level security;

create policy object_relation_read on public.object_relation for select to authenticated
  using (public.can(from_id, 'view') and public.can(to_id, 'view'));
create policy object_relation_insert on public.object_relation for insert to authenticated
  with check (public.can(from_id, 'edit_content') and public.can(to_id, 'edit_content'));
create policy object_relation_update on public.object_relation for update to authenticated
  using (public.can(from_id, 'edit_content') and public.can(to_id, 'edit_content'))
  with check (public.can(from_id, 'edit_content') and public.can(to_id, 'edit_content'));
create policy object_relation_delete on public.object_relation for delete to authenticated
  using (public.can(from_id, 'edit_content') and public.can(to_id, 'edit_content'));

revoke all on public.object_relation from anon;
revoke truncate on public.object_relation from authenticated;

-- ---------------------------------------------------------------------------
-- object_relation_all
-- ---------------------------------------------------------------------------

create view public.object_relation_all
with (security_invoker = true)
as
  -- Stored links.
  select r.id, r.organization_id, rt.key as relation_type_key,
         r.from_id, ft.key as from_type, r.to_id, tt.key as to_type,
         'object_relation'::text as source, r.position, r.created_at
  from public.object_relation r
  join public.relation_type rt on rt.id = r.relation_type_id
  join public.object fo on fo.id = r.from_id
  join public.object_type ft on ft.id = fo.type_id
  join public.object tobj on tobj.id = r.to_id
  join public.object_type tt on tt.id = tobj.type_id
  union all
  -- A project contains its tasks.
  select null, t.organization_id, 'contains', t.project_id, 'project', t.id, 'task',
         'task_project', null, t.created_at
  from public.task t where t.project_id is not null
  union all
  -- Dependencies.
  select null, t.organization_id, 'blocks', d.blocking_task_id, 'task', d.blocked_task_id, 'task',
         'task_dependency', null, d.created_at
  from public.task_dependency d
  join public.task t on t.id = d.blocked_task_id
  union all
  select null, t.organization_id, 'blocks', t.blocked_by_id, 'task', t.id, 'task',
         'task_dependency', null, t.updated_at
  from public.task t
  where t.blocked_by_id is not null
    and not exists (
      select 1 from public.task_dependency d
      where d.blocking_task_id = t.blocked_by_id and d.blocked_task_id = t.id
    )
  union all
  -- A contact is related to the records it is linked to.
  select null, l.organization_id, 'related_to', l.contact_id, 'contact', x.to_id, x.to_type,
         'crm_link', null, l.created_at
  from public.crm_link l
  cross join lateral (values
    (l.task_id, 'task'), (l.project_id, 'project'), (l.event_id, 'event')
  ) as x(to_id, to_type)
  where l.contact_id is not null and x.to_id is not null
  union all
  -- A decision was decided in its meeting.
  select null, d.organization_id, 'decided_in', d.id, 'decision', d.meeting_id, 'meeting',
         'native_column', null, d.created_at
  from public.decision d where d.meeting_id is not null
  union all
  -- A project contains its risks, meetings, events, documents and decisions.
  select null, x.organization_id, 'contains', x.project_id, 'project', x.id, x.to_type,
         'native_column', null, x.created_at
  from (
    select r.organization_id, r.project_id, r.id, 'risk'::text as to_type, r.created_at from public.risk r
    union all
    select m.organization_id, m.project_id, m.id, 'meeting', m.created_at from public.meeting m
    union all
    select e.organization_id, e.project_id, e.id, 'event', e.created_at from public.event e
    union all
    select doc.organization_id, doc.project_id, doc.id, 'document', doc.created_at from public.document doc
    union all
    select dec.organization_id, dec.project_id, dec.id, 'decision', dec.created_at from public.decision dec
  ) x
  where x.project_id is not null;

comment on view public.object_relation_all is
  'Every link between objects (M3a): object_relation plus native link columns, each filtered by its own table''s RLS.';

revoke all on public.object_relation_all from anon;
grant select on public.object_relation_all to authenticated;
