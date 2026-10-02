-- Workspace OS wave 2, unit C2: activity history on pages and records.
--
-- public.activity_entry is the "who did what and when" list shown on a page's
-- Activity tab and on a record page. Every row is named `<type>.<verb>`:
--
--   page.created, page.updated, page.moved, page.archived, page.deleted,
--   page.restored                       from public.page
--   block.added, block.removed, block.moved, block.updated
--                                       from editor_document saves (pages and
--                                       records with a block editor)
--   record.created, record.archived, record.deleted,
--   record.restored, property.updated, relation.linked, relation.unlinked,
--   comment.added                       from public.object_event (records)
--   permission.changed                  a page's visibility, or a grant's role
--   permission.granted, permission.revoked
--                                       from public.access_grant
--   version.saved, version.restored     from public.object_version
--
-- Written by triggers only (security definer), never by the application, so
-- a save, a restore or a share cannot skip its entry. Entries are never
-- deleted by people: restoring a version adds entries and keeps every older
-- one. The only rewrite is the coalescing of repeated typing in one block by
-- one person within ten minutes into one entry, and never across an entry
-- of another kind (so nothing before a restore changes).
--
-- Reading: only someone who can open the object (app.can_object_content
-- 'view': the page rules for pages, the meeting rules for meetings, app.can
-- for every other record). An entry about a relation also needs the other
-- end to be openable, and an entry naming a private property needs that
-- property to be visible (as object_event). Otherwise the row is absent.

create table public.activity_entry (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- No foreign key: history outlives a deleted object.
  object_id uuid not null,
  object_type text not null check (char_length(object_type) between 1 and 60),
  event text not null check (
    event ~ '^(page|record|block|property|relation|permission|version|comment)\.[a-z]+$'
  ),
  actor_kind text not null check (actor_kind in ('person', 'team', 'automation', 'integration', 'system')),
  actor_id uuid,
  -- What inside the object the entry is about: a block id, a property key,
  -- the other end of a relation, a grant's id.
  subject text check (subject is null or char_length(subject) <= 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  -- The object_event row this entry came from, so it is copied once.
  source_event_id uuid unique,
  occurred_at timestamptz not null default now(),
  unique (seq)
);

comment on table public.activity_entry is
  'Wave 2 C2: activity history of pages and records, named <type>.<verb>. Written by triggers only; read by whoever can open the object.';

create index activity_entry_object_idx on public.activity_entry (object_id, occurred_at desc, seq desc);
create index activity_entry_org_idx on public.activity_entry (organization_id, occurred_at desc);
create index activity_entry_coalesce_idx on public.activity_entry (object_id, subject, occurred_at desc)
  where event in ('block.added', 'block.updated');

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- Who is acting: the session's app.actor when a workflow or integration set
-- one (same rule as app.record_object_event), else the signed-in person.
create or replace function app.activity_actor(out kind text, out id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor text := nullif(current_setting('app.actor', true), '');
  v_rest text;
begin
  if v_actor is not null then
    kind := split_part(v_actor, ':', 1);
    v_rest := nullif(substr(v_actor, length(kind) + 2), '');
    if kind not in ('person', 'team', 'automation', 'integration', 'system') then
      kind := 'system';
    end if;
    if kind = 'person' and v_rest ~ '^[0-9a-fA-F-]{36}$' then
      id := v_rest::uuid;
    end if;
  elsif (select auth.uid()) is not null then
    kind := 'person';
    id := (select auth.uid());
  else
    kind := 'system';
  end if;
end;
$$;

create or replace function app.record_activity(
  p_organization uuid,
  p_object uuid,
  p_type text,
  p_event text,
  p_subject text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record := app.activity_actor();
begin
  if p_organization is null or p_object is null or p_type is null then
    return;
  end if;
  insert into public.activity_entry (organization_id, object_id, object_type, event, actor_kind, actor_id, subject, details)
  values (p_organization, p_object, p_type, p_event, v_actor.kind, v_actor.id, left(p_subject, 200),
          coalesce(p_details, '{}'::jsonb));
end;
$$;

-- The record type of an object id (pages are not in public.object yet).
create or replace function app.activity_object_type(p_object uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'page' from public.page p where p.id = p_object),
    (select t.key from public.object o join public.object_type t on t.id = o.type_id where o.id = p_object)
  );
$$;

-- Pages: created, title/icon/cover, moved to another parent, visibility (a
-- permission change), archived, trashed and restored.
create or replace function app.activity_from_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform app.record_activity(new.organization_id, new.id, 'page', 'page.created', null,
      jsonb_build_object('title', new.title));
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('field', f.key, 'before', f.b, 'after', f.a) order by f.n), '[]'::jsonb)
  into v_changes
  from (values
    (1, 'title', to_jsonb(old.title), to_jsonb(new.title)),
    (2, 'icon', to_jsonb(old.icon), to_jsonb(new.icon)),
    (3, 'cover', to_jsonb(old.cover), to_jsonb(new.cover))
  ) as f(n, key, b, a)
  where f.b is distinct from f.a;
  if jsonb_array_length(v_changes) > 0 then
    perform app.record_activity(new.organization_id, new.id, 'page', 'page.updated', null,
      jsonb_build_object('changes', v_changes));
  end if;

  if new.parent_page_id is distinct from old.parent_page_id then
    perform app.record_activity(new.organization_id, new.id, 'page', 'page.moved', null,
      jsonb_build_object('before', old.parent_page_id, 'after', new.parent_page_id));
  end if;
  if new.visibility is distinct from old.visibility then
    perform app.record_activity(new.organization_id, new.id, 'page', 'permission.changed', 'visibility',
      jsonb_build_object('field', 'visibility', 'before', old.visibility, 'after', new.visibility));
  end if;
  if new.archived_at is not null and old.archived_at is null then
    perform app.record_activity(new.organization_id, new.id, 'page', 'page.archived');
  elsif new.archived_at is null and old.archived_at is not null then
    perform app.record_activity(new.organization_id, new.id, 'page', 'page.restored');
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    perform app.record_activity(new.organization_id, new.id, 'page', 'page.deleted');
  elsif new.deleted_at is null and old.deleted_at is not null then
    perform app.record_activity(new.organization_id, new.id, 'page', 'page.restored');
  end if;
  return null;
end;
$$;

create trigger page_activity
  after insert or update on public.page
  for each row execute function app.activity_from_page();

-- Every block of a saved document with an id, in document order.
create or replace function app.activity_blocks(p_content jsonb)
returns table (block_id text, parent_id text, ord integer, type text, body text, props jsonb)
language sql
immutable
set search_path = ''
as $$
  with recursive walk as (
    select b.value as blk, null::text as parent, 0 as depth, lpad(b.ordinality::text, 6, '0') as path
    from jsonb_array_elements(
      case when jsonb_typeof(p_content -> 'blocks') = 'array' then p_content -> 'blocks' else '[]'::jsonb end
    ) with ordinality as b(value, ordinality)
    union all
    select c.value, w.blk ->> 'id', w.depth + 1, w.path || '.' || lpad(c.ordinality::text, 6, '0')
    from walk w,
         jsonb_array_elements(
           case when jsonb_typeof(w.blk -> 'children') = 'array' then w.blk -> 'children' else '[]'::jsonb end
         ) with ordinality as c(value, ordinality)
    where w.depth < 40 and jsonb_typeof(w.blk) = 'object'
  )
  select distinct on (w.blk ->> 'id')
         left(w.blk ->> 'id', 100),
         w.parent,
         (row_number() over (order by w.path))::integer,
         left(coalesce(nullif(w.blk ->> 'type', ''), 'paragraph'), 60),
         app.block_inline_text(w.blk -> 'content'),
         case when jsonb_typeof(w.blk -> 'props') = 'object' then w.blk -> 'props' else '{}'::jsonb end
  from walk w
  where jsonb_typeof(w.blk) = 'object' and nullif(w.blk ->> 'id', '') is not null
  order by w.blk ->> 'id', w.path;
$$;

-- Which elements of a sequence of distinct numbers lie on one longest
-- increasing run (patience sorting). Blocks off the run are the ones moved.
create or replace function app.activity_longest_run(p_values integer[])
returns boolean[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer := coalesce(cardinality(p_values), 0);
  v_tails integer[] := '{}';
  v_prev integer[];
  v_keep boolean[];
  v_len integer := 0;
  v_lo integer;
  v_hi integer;
  v_mid integer;
  v_k integer;
begin
  if v_n = 0 then
    return '{}';
  end if;
  v_prev := array_fill(0, array[v_n]);
  v_keep := array_fill(false, array[v_n]);
  for i in 1..v_n loop
    v_lo := 1;
    v_hi := v_len;
    while v_lo <= v_hi loop
      v_mid := (v_lo + v_hi) / 2;
      if p_values[v_tails[v_mid]] < p_values[i] then
        v_lo := v_mid + 1;
      else
        v_hi := v_mid - 1;
      end if;
    end loop;
    if v_lo > 1 then
      v_prev[i] := v_tails[v_lo - 1];
    end if;
    v_tails[v_lo] := i;
    if v_lo > v_len then
      v_len := v_lo;
    end if;
  end loop;
  v_k := v_tails[v_len];
  while v_k > 0 loop
    v_keep[v_k] := true;
    v_k := v_prev[v_k];
  end loop;
  return v_keep;
end;
$$;

-- Block changes between two saved documents: added, removed, moved (to
-- another parent, or out of order with the blocks around it) and updated
-- (text, type or settings).
create or replace function app.activity_block_changes(p_old jsonb, p_new jsonb)
returns table (event text, block_id text, type text, body text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids text[];
  v_ranks integer[];
  v_keep boolean[];
begin
  return query
    select 'block.added', n.block_id, n.type, n.body
    from app.activity_blocks(p_new) n
    where not exists (select 1 from app.activity_blocks(p_old) o where o.block_id = n.block_id)
    order by n.ord;

  return query
    select 'block.removed', o.block_id, o.type, o.body
    from app.activity_blocks(p_old) o
    where not exists (select 1 from app.activity_blocks(p_new) n where n.block_id = o.block_id)
    order by o.ord;

  -- Moved under another parent.
  return query
    select 'block.moved', n.block_id, n.type, n.body
    from app.activity_blocks(p_new) n
    join app.activity_blocks(p_old) o on o.block_id = n.block_id
    where n.parent_id is distinct from o.parent_id
    order by n.ord;

  -- Moved within the same parent: off the longest run of kept order.
  select array_agg(n.block_id order by n.ord), array_agg(o.ord order by n.ord)
  into v_ids, v_ranks
  from app.activity_blocks(p_new) n
  join app.activity_blocks(p_old) o on o.block_id = n.block_id
  where n.parent_id is not distinct from o.parent_id;
  if v_ids is not null then
    v_keep := app.activity_longest_run(v_ranks);
    return query
      select 'block.moved', n.block_id, n.type, n.body
      from unnest(v_ids, v_keep) as k(id, kept)
      join app.activity_blocks(p_new) n on n.block_id = k.id
      where not k.kept
      order by n.ord;
  end if;

  return query
    select 'block.updated', n.block_id, n.type, n.body
    from app.activity_blocks(p_new) n
    join app.activity_blocks(p_old) o on o.block_id = n.block_id
    where n.type is distinct from o.type or n.body is distinct from o.body or n.props is distinct from o.props
    order by n.ord;
end;
$$;

-- More than this many entries of one kind in one save become one entry with
-- a count (a large paste or deletion).
create or replace function app.activity_from_editor_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record := app.activity_actor();
  v_changes jsonb;
  v_change jsonb;
  v_count record;
  v_counts jsonb;
  v_existing uuid;
  v_limit constant integer := 20;
begin
  if new.content is not distinct from old.content then
    return null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_changes
  from app.activity_block_changes(old.content, new.content) c;
  select coalesce(jsonb_object_agg(c.event, c.n), '{}'::jsonb) into v_counts
  from (select e ->> 'event' as event, count(*) as n from jsonb_array_elements(v_changes) e group by 1) c;

  for v_change in select e from jsonb_array_elements(v_changes) e loop
    if (v_counts ->> (v_change ->> 'event'))::integer > v_limit then
      continue;
    end if;
    if v_change ->> 'event' = 'block.updated' then
      -- Typing in one block keeps one entry per person per ten minutes.
      v_existing := null;
      select e.id into v_existing
      from public.activity_entry e
      where e.object_id = new.object_id
        and e.subject = v_change ->> 'block_id'
        and e.event in ('block.added', 'block.updated')
        and e.actor_kind = v_actor.kind
        and e.actor_id is not distinct from v_actor.id
        and e.occurred_at > now() - interval '10 minutes'
        -- Never across another kind of entry (a restore, a move, a share):
        -- what came before it stays as it was.
        and not exists (
          select 1 from public.activity_entry x
          where x.object_id = e.object_id and x.seq > e.seq
            and x.event not in ('block.added', 'block.updated')
        )
      order by e.occurred_at desc, e.seq desc
      limit 1;
      if v_existing is not null then
        update public.activity_entry e
        set details = e.details || jsonb_build_object('type', v_change ->> 'type', 'text', left(v_change ->> 'body', 120)),
            occurred_at = case when e.event = 'block.updated' then now() else e.occurred_at end
        where e.id = v_existing;
        continue;
      end if;
    end if;
    perform app.record_activity(new.organization_id, new.object_id, new.object_type, v_change ->> 'event',
      v_change ->> 'block_id',
      jsonb_build_object('type', v_change ->> 'type', 'text', left(v_change ->> 'body', 120)));
  end loop;

  for v_count in select c.key as event, c.value::integer as n from jsonb_each_text(v_counts) c loop
    if v_count.n > v_limit then
      perform app.record_activity(new.organization_id, new.object_id, new.object_type, v_count.event, null,
        jsonb_build_object('count', v_count.n));
    end if;
  end loop;
  return null;
end;
$$;

create trigger editor_document_activity
  after update of content on public.editor_document
  for each row execute function app.activity_from_editor_document();

-- Records: the object_event log, renamed and split so each property change
-- is its own entry (and keeps its property id for the privacy check).
create or replace function app.activity_from_object_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change jsonb;
  v_actor uuid := case when new.actor_kind = 'person' and new.actor_id ~ '^[0-9a-fA-F-]{36}$'
                       then new.actor_id::uuid end;
begin
  if new.verb in ('created', 'archived', 'restored', 'deleted') then
    insert into public.activity_entry
      (organization_id, object_id, object_type, event, actor_kind, actor_id, details, source_event_id, occurred_at)
    values (new.organization_id, new.object_id, new.object_type, 'record.' || new.verb, new.actor_kind, v_actor,
            jsonb_build_object('changes', new.changes), new.id, new.occurred_at)
    on conflict (source_event_id) do nothing;
  elsif new.verb = 'commented' then
    insert into public.activity_entry
      (organization_id, object_id, object_type, event, actor_kind, actor_id, details, source_event_id, occurred_at)
    values (new.organization_id, new.object_id, new.object_type, 'comment.added', new.actor_kind, v_actor,
            '{}'::jsonb, new.id, new.occurred_at)
    on conflict (source_event_id) do nothing;
  elsif new.verb in ('linked', 'unlinked') then
    v_change := new.changes -> 0;
    insert into public.activity_entry
      (organization_id, object_id, object_type, event, actor_kind, actor_id, subject, details, source_event_id, occurred_at)
    values (new.organization_id, new.object_id, new.object_type, 'relation.' || new.verb, new.actor_kind, v_actor,
            v_change ->> 'other', coalesce(v_change, '{}'::jsonb), new.id, new.occurred_at)
    on conflict (source_event_id) do nothing;
  elsif new.verb = 'updated' then
    -- One entry per property; only the first carries the source id.
    for v_change in select c from jsonb_array_elements(new.changes) c loop
      insert into public.activity_entry
        (organization_id, object_id, object_type, event, actor_kind, actor_id, subject, details, source_event_id, occurred_at)
      values (new.organization_id, new.object_id, new.object_type, 'property.updated', new.actor_kind, v_actor,
              v_change ->> 'property', jsonb_build_object('changes', jsonb_build_array(v_change)),
              case when v_change = new.changes -> 0 then new.id end, new.occurred_at)
      on conflict (source_event_id) do nothing;
    end loop;
  end if;
  return null;
end;
$$;

create trigger object_event_activity
  after insert on public.object_event
  for each row execute function app.activity_from_object_event();

-- Sharing: a grant added, its role changed, or removed.
create or replace function app.activity_from_access_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.access_grant := case when tg_op = 'DELETE' then old else new end;
  v_type text := app.activity_object_type(v_row.object_id);
  v_role jsonb;
  v_before jsonb;
  v_details jsonb;
begin
  if v_type is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.role_id is not distinct from old.role_id and new.reach is not distinct from old.reach then
    return null;
  end if;
  select jsonb_build_object('key', r.key, 'name_en', r.name_en, 'name_fr', r.name_fr) into v_role
  from public.access_role r where r.id = v_row.role_id;
  v_details := jsonb_build_object(
    'principal_kind', v_row.principal_kind,
    'user_id', v_row.user_id,
    'team_id', v_row.team_id,
    'org_role', v_row.org_role,
    'role', v_role,
    'reach', v_row.reach
  );
  if tg_op = 'UPDATE' then
    select jsonb_build_object('key', r.key, 'name_en', r.name_en, 'name_fr', r.name_fr) into v_before
    from public.access_role r where r.id = old.role_id;
    v_details := v_details || jsonb_build_object('before_role', v_before);
  end if;
  perform app.record_activity(v_row.organization_id, v_row.object_id, v_type,
    case tg_op when 'INSERT' then 'permission.granted' when 'DELETE' then 'permission.revoked' else 'permission.changed' end,
    v_row.id::text, v_details);
  return null;
end;
$$;

create trigger access_grant_activity
  after insert or update or delete on public.access_grant
  for each row execute function app.activity_from_access_grant();

-- Versions: a named version saved, and a restore (whose "before restore"
-- snapshot save_object_version writes first).
create or replace function app.activity_from_object_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'restore' then
    perform app.record_activity(new.organization_id, new.object_id, new.object_type, 'version.restored', new.id::text,
      jsonb_build_object('version_id', new.id));
  elsif new.kind = 'manual' then
    perform app.record_activity(new.organization_id, new.object_id, new.object_type, 'version.saved', new.id::text,
      jsonb_build_object('version_id', new.id, 'label', new.label));
  end if;
  return null;
end;
$$;

create trigger object_version_activity
  after insert on public.object_version
  for each row execute function app.activity_from_object_version();

revoke all on function app.activity_actor() from public, anon, authenticated;
revoke all on function app.record_activity(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app.activity_object_type(uuid) from public, anon, authenticated;
revoke all on function app.activity_from_page() from public, anon, authenticated;
revoke all on function app.activity_blocks(jsonb) from public, anon, authenticated;
revoke all on function app.activity_longest_run(integer[]) from public, anon, authenticated;
revoke all on function app.activity_block_changes(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.activity_from_editor_document() from public, anon, authenticated;
revoke all on function app.activity_from_object_event() from public, anon, authenticated;
revoke all on function app.activity_from_access_grant() from public, anon, authenticated;
revoke all on function app.activity_from_object_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create or replace function app.can_read_activity(
  p_type text,
  p_object uuid,
  p_details jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_object_content(p_type, p_object, 'view')
    and app.can_view_event_changes(coalesce(p_details -> 'changes', '[]'::jsonb))
    and (
      app.jsonb_uuid(p_details, 'other') is null
      or app.can_object_content(
        coalesce(p_details ->> 'other_type', app.activity_object_type(app.jsonb_uuid(p_details, 'other')), ''),
        app.jsonb_uuid(p_details, 'other'),
        'view'
      )
    );
$$;

revoke all on function app.can_read_activity(text, uuid, jsonb) from public, anon;
grant execute on function app.can_read_activity(text, uuid, jsonb) to authenticated;

alter table public.activity_entry enable row level security;

create policy activity_entry_read on public.activity_entry
  for select to authenticated
  using (app.can_read_activity(object_type, object_id, details));
-- No write policies: only the triggers above write, with definer rights.

revoke all on public.activity_entry from anon, authenticated;
grant select on public.activity_entry to authenticated;
grant all on public.activity_entry to service_role;
