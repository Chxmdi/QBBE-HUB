-- Workspace OS Find (M12, epic #199, stream S4).
--
-- One search across every kind of record, for the search page and the
-- command palette. It improves on global_search (kept as it is) in three ways:
--
--   * French-aware. Matching ignores case and accents ("reunion" finds
--     "Réunion", "ecole" finds "École"), every word must appear, in any order,
--     and descriptions also match by French and English stem ("réunions"
--     finds "réunion").
--   * Filters by record type and by space (a program: the record's own
--     program, or its project's).
--   * Ranked: exact title, then title starting with the words, then all words
--     in the title, then matches in the description; newest first within a
--     rank. Paged, with the total.
--
-- Security: `security invoker`, so every table's RLS decides what exists.
-- A record a person cannot open never appears, not even its title. The query
-- text is only ever a bound value; there is no dynamic SQL.

create extension if not exists unaccent with schema extensions;

-- Case- and accent-folded text. Immutable (the dictionary is named), so it can
-- back an index.
create or replace function public.find_fold(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, '')));
$$;

-- True when every word appears in the folded text.
create or replace function public.find_all_words(p_folded text, p_words text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select not exists (select 1 from unnest(p_words) w where position(w in p_folded) = 0);
$$;

-- Trigram indexes on the folded titles people search most.
create index if not exists task_title_find_idx on public.task using gin (public.find_fold(title) gin_trgm_ops);
create index if not exists project_name_find_idx on public.project using gin (public.find_fold(name) gin_trgm_ops);
create index if not exists document_title_find_idx on public.document using gin (public.find_fold(title) gin_trgm_ops);

create or replace function public.find(
  p_query text,
  p_types text[] default null,
  p_space uuid default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  result_type text,
  id uuid,
  title text,
  snippet text,
  href text,
  space_id uuid,
  rank real,
  updated_at timestamptz,
  total bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_folded text;
  v_words text[];
  v_types text[];
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000);
  v_french tsquery;
  v_english tsquery;
begin
  if length(v_query) < 2 or length(v_query) > 200 or (select auth.uid()) is null then
    return;
  end if;
  v_folded := public.find_fold(v_query);
  select coalesce(array_agg(w), array[]::text[]) into v_words
  from (select w from regexp_split_to_table(v_folded, '\s+') w where w <> '' limit 8) words;
  if cardinality(v_words) = 0 then
    return;
  end if;
  v_types := coalesce(p_types, array['task', 'project', 'program', 'meeting', 'decision', 'event',
    'document', 'risk', 'issue', 'contact', 'crm', 'person', 'opportunity']);
  v_french := plainto_tsquery('french'::regconfig, extensions.unaccent('extensions.unaccent'::regdictionary, v_query));
  v_english := plainto_tsquery('english'::regconfig, v_query);

  return query
  with candidates as (
    select 'task'::text as kind, t.id, t.title, coalesce(left(t.description, 160), '') as body,
      '/my-work?task=' || t.id as link,
      coalesce(t.program_id, (select p.program_id from public.project p where p.id = t.project_id)) as space,
      t.updated_at as changed
    from public.task t
    where 'task' = any (v_types) and t.archived_at is null
      and (public.find_all_words(public.find_fold(t.title), v_words)
        or public.find_all_words(public.find_fold(t.description), v_words))
    union all
    select 'project', p.id, p.name, coalesce(left(coalesce(p.outcome, p.description), 160), ''),
      '/projects/' || p.id, p.program_id, p.updated_at
    from public.project p
    where 'project' = any (v_types) and p.archived_at is null
      and (public.find_all_words(public.find_fold(p.name), v_words)
        or public.find_all_words(public.find_fold(coalesce(p.outcome, '') || ' ' || coalesce(p.description, '')), v_words))
    union all
    select 'program', pr.id, pr.name, coalesce(left(pr.description, 160), ''), '/programs/' || pr.id, pr.id, pr.updated_at
    from public.program pr
    where 'program' = any (v_types) and pr.archived_at is null
      and (public.find_all_words(public.find_fold(pr.name), v_words)
        or public.find_all_words(public.find_fold(pr.description), v_words))
    union all
    select 'meeting', m.id, m.title, coalesce(to_char(m.starts_at, 'YYYY-MM-DD HH24:MI'), ''), '/meetings/' || m.id,
      coalesce(m.program_id, (select p.program_id from public.project p where p.id = m.project_id)), m.updated_at
    from public.meeting m
    where 'meeting' = any (v_types)
      and public.find_all_words(public.find_fold(m.title), v_words)
    union all
    select 'decision', d.id, d.title, coalesce(left(d.detail, 160), ''),
      '/projects/' || d.project_id || '?tab=risks&decision=' || d.id,
      (select p.program_id from public.project p where p.id = d.project_id), d.created_at
    from public.decision d
    where 'decision' = any (v_types) and d.project_id is not null
      and (public.find_all_words(public.find_fold(d.title), v_words)
        or public.find_all_words(public.find_fold(d.detail), v_words))
    union all
    select 'event', e.id, e.name, coalesce(left(e.description, 160), ''), '/events/' || e.id,
      coalesce(e.program_id, (select p.program_id from public.project p where p.id = e.project_id)), e.updated_at
    from public.event e
    where 'event' = any (v_types)
      and (public.find_all_words(public.find_fold(e.name), v_words)
        or public.find_all_words(public.find_fold(e.description), v_words))
    union all
    select 'document', doc.id, doc.title, coalesce(left(doc.description, 160), ''), '/documents?document=' || doc.id,
      coalesce(doc.program_id, (select p.program_id from public.project p where p.id = doc.project_id)), doc.updated_at
    from public.document doc
    where 'document' = any (v_types) and doc.archived_at is null
      and (public.find_all_words(public.find_fold(doc.title), v_words)
        or public.find_all_words(public.find_fold(doc.description), v_words))
    union all
    select 'risk', r.id, r.title, coalesce(left(r.description, 160), ''),
      '/projects/' || r.project_id || '?tab=risks&risk=' || r.id,
      (select p.program_id from public.project p where p.id = r.project_id), r.updated_at
    from public.risk r
    where 'risk' = any (v_types)
      and (public.find_all_words(public.find_fold(r.title), v_words)
        or public.find_all_words(public.find_fold(r.description), v_words))
    union all
    select 'issue', i.id, i.title, coalesce(left(i.description, 160), ''),
      '/projects/' || i.project_id || '?tab=risks&issue=' || i.id,
      (select p.program_id from public.project p where p.id = i.project_id), i.updated_at
    from public.issue i
    where 'issue' = any (v_types)
      and (public.find_all_words(public.find_fold(i.title), v_words)
        or public.find_all_words(public.find_fold(i.description), v_words))
    union all
    select 'contact', ct.id, ct.full_name, coalesce(ct.role_title, ''),
      '/crm/' || coalesce(ct.crm_organization_id, ct.id) || '?contact=' || ct.id, null::uuid, ct.updated_at
    from public.crm_contact ct
    where 'contact' = any (v_types)
      and public.find_all_words(public.find_fold(ct.full_name), v_words)
    union all
    select 'crm', co.id, co.name, coalesce(co.category::text, ''), '/crm/' || co.id, null::uuid, co.updated_at
    from public.crm_organization co
    where 'crm' = any (v_types)
      and public.find_all_words(public.find_fold(co.name), v_words)
    union all
    select 'person', u.id, u.full_name, coalesce(u.title, ''), '/people?person=' || u.id, null::uuid, u.updated_at
    from public.user_profile u
    where 'person' = any (v_types)
      and public.find_all_words(public.find_fold(u.full_name), v_words)
    union all
    select 'opportunity', o.id, o.title, coalesce(left(o.description, 160), ''),
      '/crm/' || o.crm_organization_id || '?opportunity=' || o.id,
      coalesce(o.program_id, (select p.program_id from public.project p where p.id = o.project_id)), o.updated_at
    from public.opportunity o
    where 'opportunity' = any (v_types)
      and (public.find_all_words(public.find_fold(o.title), v_words)
        or public.find_all_words(public.find_fold(o.description), v_words))
  ),
  -- Descriptions also match by stem, in French and English.
  stemmed as (
    select 'task'::text as kind, t.id, t.title, coalesce(left(t.description, 160), '') as body,
      '/my-work?task=' || t.id as link,
      coalesce(t.program_id, (select p.program_id from public.project p where p.id = t.project_id)) as space,
      t.updated_at as changed
    from public.task t
    where 'task' = any (v_types) and t.archived_at is null and t.description is not null
      and (to_tsvector('french'::regconfig, extensions.unaccent('extensions.unaccent'::regdictionary, t.title || ' ' || t.description)) @@ v_french
        or to_tsvector('english'::regconfig, t.title || ' ' || t.description) @@ v_english)
    union all
    select 'document', doc.id, doc.title, coalesce(left(doc.description, 160), ''), '/documents?document=' || doc.id,
      coalesce(doc.program_id, (select p.program_id from public.project p where p.id = doc.project_id)), doc.updated_at
    from public.document doc
    where 'document' = any (v_types) and doc.archived_at is null
      and (to_tsvector('french'::regconfig, extensions.unaccent('extensions.unaccent'::regdictionary, doc.title || ' ' || coalesce(doc.description, ''))) @@ v_french
        or to_tsvector('english'::regconfig, doc.title || ' ' || coalesce(doc.description, '')) @@ v_english)
  ),
  hits as (
    select distinct on (c.kind, c.id) c.*
    from (select * from candidates union all select * from stemmed) c
    where p_space is null or c.space = p_space
    order by c.kind, c.id
  ),
  ranked as (
    select h.kind, h.id, h.title, h.body, h.link, h.space, h.changed,
      (case
        when public.find_fold(h.title) = v_folded then 4
        when public.find_fold(h.title) like v_words[1] || '%' and public.find_all_words(public.find_fold(h.title), v_words) then 3
        when public.find_all_words(public.find_fold(h.title), v_words) then 2
        else 1
      end)::real as score
    from hits h
  )
  select r.kind, r.id, r.title, r.body, r.link, r.space, r.score, r.changed, count(*) over ()
  from ranked r
  order by r.score desc, r.changed desc nulls last, r.title, r.id
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.find(text, text[], uuid, integer, integer) from public, anon;
grant execute on function public.find(text, text[], uuid, integer, integer) to authenticated, service_role;
revoke all on function public.find_fold(text) from public, anon;
grant execute on function public.find_fold(text) to authenticated, service_role;
revoke all on function public.find_all_words(text, text[]) from public, anon;
grant execute on function public.find_all_words(text, text[]) to authenticated, service_role;

comment on function public.find(text, text[], uuid, integer, integer) is
  'Workspace OS Find (M12): accent- and case-insensitive search across record types, '
  'filtered by type and space, ranked and paged. Security invoker: RLS decides every row.';
