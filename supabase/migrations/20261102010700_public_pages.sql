-- Workspace OS public pages (V1-18, plan A13, epic #199, stream S2).
--
-- A space, project or Workspace OS page can be published by an owner or
-- admin. The safeguards the plan asks for:
--
--   * Publishing writes a read-only COPY of chosen fields to its own table,
--     public.published_page. The public route reads only that table, never
--     live data, so nothing but the approved copy can ever reach a visitor.
--   * Properties marked private (property_definition.visible_to_roles) are
--     never offered and never copied.
--   * A review step: one owner or admin asks, a DIFFERENT owner or admin
--     approves after seeing exactly what will be published. Only approval
--     writes the copy.
--   * Unpublish deletes the copy in the same statement: it is gone at once.
--     Deleting the source deletes its publication and copy too.
--   * Nothing in a private space can be published.
--   * Behind the wos_public_pages switch, in the database itself: while the
--     workspace-wide row is off, nothing can be requested or approved and the
--     copies cannot be read. (The WORKSPACE_OS_FLAGS staging override cannot
--     reach the database, so staging turns this row on to try public pages.)
--
-- Everything is written through the functions below; the tables take no
-- direct writes from the API.

create or replace function app.public_pages_enabled()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select f.enabled from public.feature_flag f
    where f.key = 'wos_public_pages' and f.organization_id is null
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.publication (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_id uuid not null references app.access_node (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  fields text[] not null check (cardinality(fields) between 1 and 50),
  status text not null default 'in_review'
    check (status in ('in_review', 'published', 'rejected', 'unpublished')),
  requested_by uuid references public.user_profile (id) on delete set null,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.user_profile (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  unpublished_by uuid references public.user_profile (id) on delete set null,
  unpublished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index publication_org_idx on public.publication (organization_id, status);
create index publication_object_idx on public.publication (object_id);
-- One live (asked or published) publication per source at a time.
create unique index publication_one_live_per_object
  on public.publication (object_id) where status in ('in_review', 'published');

create trigger publication_set_updated_at
  before update on public.publication
  for each row execute function public.set_updated_at();

comment on table public.publication is
  'Workspace OS public pages (V1-18): the request, review and state of each publication. Owners and admins only.';

create table public.published_page (
  publication_id uuid primary key references public.publication (id) on delete cascade,
  slug text not null unique,
  title_en text not null,
  title_fr text not null,
  -- [{key, label_en, label_fr, value}] in the order chosen; values are text.
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  published_at timestamptz not null default now()
);

comment on table public.published_page is
  'Workspace OS public pages (V1-18): the read-only copy of chosen fields a visitor sees. The public route reads only this table.';

-- ---------------------------------------------------------------------------
-- What could be published from a source: never a private property.
-- ---------------------------------------------------------------------------

create or replace function app.publishable_fields(p_object uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_node app.access_node%rowtype;
  v_fields jsonb := '[]'::jsonb;
  v_row record;
begin
  select * into v_node from app.access_node n where n.id = p_object;
  if not found or v_node.in_private then
    return null;
  end if;

  if v_node.kind = 'space' then
    select jsonb_build_array(
             jsonb_build_object('key', 'title', 'label_en', 'Name', 'label_fr', 'Nom',
                                'value_en', s.name_en, 'value_fr', s.name_fr),
             jsonb_build_object('key', 'description', 'label_en', 'Description', 'label_fr', 'Description',
                                'value', s.description))
    into v_fields
    from public.space s where s.id = p_object;
  elsif v_node.kind = 'project' then
    select jsonb_build_array(
             jsonb_build_object('key', 'title', 'label_en', 'Name', 'label_fr', 'Nom', 'value', p.name),
             jsonb_build_object('key', 'outcome', 'label_en', 'Outcome', 'label_fr', 'Résultat visé', 'value', p.outcome),
             jsonb_build_object('key', 'description', 'label_en', 'Description', 'label_fr', 'Description',
                                'value', p.description))
    into v_fields
    from public.project p where p.id = p_object;
  elsif v_node.kind = 'object' and to_regclass('public.object') is not null then
    for v_row in execute $sql$
      select o.title from public.object o where o.id = $1
    $sql$ using p_object loop
      v_fields := jsonb_build_array(
        jsonb_build_object('key', 'title', 'label_en', 'Title', 'label_fr', 'Titre', 'value', v_row.title));
    end loop;
    if to_regclass('public.property_definition') is not null and to_regclass('public.property_value') is not null then
      for v_row in execute $sql$
        select d.key, d.name_en, d.name_fr,
               coalesce(v.value_text, v.value_number::text, v.value_date::text
                        || coalesce(' – ' || v.value_date_end::text, ''), v.value_bool::text) as value
        from public.property_definition d
        join public.object o on o.id = $1 and o.type_id = d.type_id and o.organization_id = d.organization_id
        left join public.property_value v on v.object_id = o.id and v.property_id = d.id
        where d.visible_to_roles is null
          and d.archived_at is null
          and d.system_column is null
        order by d.key
      $sql$ using p_object loop
        v_fields := v_fields || jsonb_build_array(jsonb_build_object(
          'key', 'property:' || v_row.key, 'label_en', v_row.name_en, 'label_fr', v_row.name_fr, 'value', v_row.value));
      end loop;
    end if;
  else
    return null;
  end if;
  return v_fields;
end;
$$;

-- The copy of the chosen fields, in the order chosen, and the title.
create or replace function app.publication_copy(p_object uuid, p_fields text[])
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with candidates as (
    select f, ord from jsonb_array_elements(app.publishable_fields(p_object)) with ordinality as c (f, ord)
  ),
  title as (
    select coalesce(f ->> 'value_en', f ->> 'value') as en, coalesce(f ->> 'value_fr', f ->> 'value') as fr
    from candidates where f ->> 'key' = 'title'
  )
  select jsonb_build_object(
    'title_en', coalesce((select en from title), ''),
    'title_fr', coalesce((select fr from title), ''),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', c.f ->> 'key', 'label_en', c.f ->> 'label_en', 'label_fr', c.f ->> 'label_fr',
               'value', coalesce(c.f ->> 'value', c.f ->> 'value_en'),
               'value_fr', coalesce(c.f ->> 'value_fr', c.f ->> 'value')) order by k.ord)
      from unnest(p_fields) with ordinality as k (key, ord)
      join candidates c on c.f ->> 'key' = k.key
      where k.key <> 'title'), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- The steps, each an owner or admin with two-step sign-in in the source's
-- organization, who can view the source.
-- ---------------------------------------------------------------------------

create or replace function app.publication_guard(p_object uuid)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not app.public_pages_enabled() then
    raise exception 'Public pages are turned off.' using errcode = '42501';
  end if;
  select n.organization_id into v_org from app.access_node n where n.id = p_object;
  if v_org is null or not app.is_org_admin(v_org) or app.access_bits(p_object) & 1 = 0 then
    raise exception 'Only an owner or administrator with two-step sign-in can publish this.' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

-- What is on offer for a source, for the request form.
create or replace function public.publication_candidates(object_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.publication_guard(publication_candidates.object_id);
  return app.publishable_fields(publication_candidates.object_id);
end;
$$;

create or replace function public.publication_request(object_id uuid, slug text, fields text[])
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_org uuid := app.publication_guard(publication_request.object_id);
  v_candidates jsonb := app.publishable_fields(publication_request.object_id);
  v_id uuid;
begin
  if v_candidates is null then
    raise exception 'This cannot be published (it is private, or not a space, project or page).' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(publication_request.fields) f
    where not exists (select 1 from jsonb_array_elements(v_candidates) c where c ->> 'key' = f)
  ) then
    raise exception 'Only the offered fields can be published; private properties never can.' using errcode = '23514';
  end if;
  insert into public.publication (organization_id, object_id, slug, fields, requested_by)
  values (v_org, publication_request.object_id, lower(publication_request.slug),
          array(select distinct f from unnest(publication_request.fields) f), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Exactly what approval would publish, for the review step.
create or replace function public.publication_preview(publication_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_pub public.publication%rowtype;
begin
  select * into v_pub from public.publication p where p.id = publication_id;
  if not found then
    raise exception 'No such publication.' using errcode = 'P0002';
  end if;
  perform app.publication_guard(v_pub.object_id);
  return app.publication_copy(v_pub.object_id, v_pub.fields);
end;
$$;

create or replace function public.publication_review(publication_id uuid, approve boolean, note text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_pub public.publication%rowtype;
  v_copy jsonb;
begin
  select * into v_pub from public.publication p where p.id = publication_id for update;
  if not found or v_pub.status <> 'in_review' then
    raise exception 'Only a publication waiting for review can be reviewed.' using errcode = '23514';
  end if;
  perform app.publication_guard(v_pub.object_id);
  if v_pub.requested_by = (select auth.uid()) then
    raise exception 'Another owner or administrator must review what you asked to publish.' using errcode = '42501';
  end if;

  update public.publication
  set status = case when approve then 'published' else 'rejected' end,
      reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = left(note, 1000)
  where id = v_pub.id;

  if approve then
    v_copy := app.publication_copy(v_pub.object_id, v_pub.fields);
    insert into public.published_page (publication_id, slug, title_en, title_fr, fields)
    values (v_pub.id, v_pub.slug, v_copy ->> 'title_en', v_copy ->> 'title_fr', v_copy -> 'fields');
  end if;
end;
$$;

create or replace function public.publication_unpublish(publication_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_pub public.publication%rowtype;
begin
  select * into v_pub from public.publication p where p.id = publication_id for update;
  if not found or v_pub.status not in ('published', 'in_review') then
    raise exception 'Only a published or pending publication can be taken down.' using errcode = '23514';
  end if;
  -- Taking a page down is allowed even with the switch off.
  if not app.is_org_admin(v_pub.organization_id) then
    raise exception 'Only an owner or administrator with two-step sign-in can unpublish.' using errcode = '42501';
  end if;
  delete from public.published_page where published_page.publication_id = v_pub.id;
  update public.publication
  set status = 'unpublished', unpublished_by = (select auth.uid()), unpublished_at = now()
  where id = v_pub.id;
end;
$$;

-- Which of the things a member can see are public now, for the "Public"
-- badge wherever they appear.
create or replace function public.published_object_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select p.object_id
  from public.publication p
  join public.published_page pp on pp.publication_id = p.id
  where p.status = 'published'
    and app.is_org_member(p.organization_id)
    and app.access_bits(p.object_id) & 1 <> 0;
$$;

-- Visitors: is the switch on at all (the route answers not-found when off).
create or replace function public.public_pages_enabled()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.public_pages_enabled();
$$;

revoke all on function app.public_pages_enabled(), app.publishable_fields(uuid), app.publication_copy(uuid, text[]),
  app.publication_guard(uuid) from public, anon, authenticated;
grant execute on function app.public_pages_enabled() to anon, authenticated, service_role;
revoke all on function public.publication_candidates(uuid), public.publication_request(uuid, text, text[]),
  public.publication_preview(uuid), public.publication_review(uuid, boolean, text),
  public.publication_unpublish(uuid), public.published_object_ids() from public, anon;
grant execute on function public.publication_candidates(uuid), public.publication_request(uuid, text, text[]),
  public.publication_preview(uuid), public.publication_review(uuid, boolean, text),
  public.publication_unpublish(uuid), public.published_object_ids() to authenticated, service_role;
revoke all on function public.public_pages_enabled() from public;
grant execute on function public.public_pages_enabled() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.publication enable row level security;
alter table public.published_page enable row level security;

create policy publication_admin_read on public.publication
  for select to authenticated
  using (app.is_org_admin(organization_id));

-- The copy is public while the switch is on: that is its whole purpose.
create policy published_page_public_read on public.published_page
  for select to anon, authenticated
  using (app.public_pages_enabled());

revoke all on public.publication, public.published_page from anon, authenticated;
grant select on public.publication to authenticated;
grant select on public.published_page to anon, authenticated;
grant all on public.publication, public.published_page to service_role;

-- A space deleted for good (only the service role can) takes its access node
-- with it, and so its grants, cache rows, publication and public copy. M10b
-- placed spaces as nodes but only on insert and update.
create or replace function app.access_on_space_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from app.access_node n where n.id = old.id and n.kind = 'space';
  return null;
end;
$$;
revoke all on function app.access_on_space_delete() from public, anon, authenticated;

create trigger zz_access_sync_delete after delete on public.space
  for each row execute function app.access_on_space_delete();
