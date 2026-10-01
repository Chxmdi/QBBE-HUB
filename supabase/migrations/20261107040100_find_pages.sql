-- QBBE Hub — Find searches pages too (M12 + M4a).
--
-- Find (20261104010300) covered every record kind except the Workspace OS
-- page, so a page could be reached only from the Pages tree. A page is found
-- by its title or by any words in its blocks, the rows the editor derives on
-- every save (M4b), in French and English, accents and case ignored, like
-- every other kind. Pages carry no program, so the space filter leaves them
-- out. The function stays security invoker: page_read and block_read decide
-- what each viewer sees, so a private page never appears for anyone else.
--
-- The function body is the previous one with the two page branches added;
-- nothing else changes.

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
    'document', 'page', 'risk', 'issue', 'contact', 'crm', 'person', 'opportunity']);
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
    -- A page (M4a): its title and the text of its blocks, which the editor
    -- derives on every save (M4b). Pages have no program, so the space filter
    -- leaves them out; RLS on page and block decides what the viewer sees.
    select 'page', pg.id, case when pg.title = '' then '' else pg.title end,
      coalesce(left((select string_agg(b.text, ' ' order by b.position) from public.block b
                     where b.object_id = pg.id and b.object_type = 'page' and b.text <> ''), 160), ''),
      '/pages/' || pg.id, null::uuid, pg.updated_at
    from public.page pg
    where 'page' = any (v_types) and pg.archived_at is null and pg.deleted_at is null
      and (public.find_all_words(public.find_fold(pg.title), v_words)
        or public.find_all_words(public.find_fold(coalesce((select string_agg(b.text, ' ' order by b.position)
              from public.block b where b.object_id = pg.id and b.object_type = 'page'), '')), v_words))
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
    union all
    select 'page', pg.id, pg.title,
      coalesce(left(pt.body, 160), ''), '/pages/' || pg.id, null::uuid, pg.updated_at
    from public.page pg
    cross join lateral (select coalesce(string_agg(b.text, ' ' order by b.position), '') as body
                        from public.block b where b.object_id = pg.id and b.object_type = 'page') pt
    where 'page' = any (v_types) and pg.archived_at is null and pg.deleted_at is null
      and (to_tsvector('french'::regconfig, extensions.unaccent('extensions.unaccent'::regdictionary, pg.title || ' ' || pt.body)) @@ v_french
        or to_tsvector('english'::regconfig, pg.title || ' ' || pt.body) @@ v_english)
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
