-- QBBE Hub — teach global search about risks, issues, and documents, and stop
-- the tail of the result set from being starved.
--
-- Three record types existed that search could not see. A record nobody can
-- find is half-built: the RAID log lives two clicks inside a project tab, and
-- documents sit on a flat list that stops being scannable the moment it grows.
-- Both are exactly what somebody reaches for by name, weeks later, from the
-- command palette.
--
-- Unlike the other branches, these three match on the body as well as the
-- title. A risk called "Grant shortfall" carries the word "funding" in its
-- description, not its name — the same reason the message branch searches
-- bodies rather than subjects.
--
-- The starvation fix. The previous shape was a UNION ALL of per-type branches
-- with a single LIMIT over the whole thing and no ordering, so the database was
-- free to return the first p_limit rows it assembled. With nine branches and
-- the palette asking for twelve results, the last branches could be cut
-- entirely — and the three added here would have gone straight onto the end of
-- that queue, permanently invisible in the palette. Results are now
-- round-robined: the best of every type first, then the second of every type,
-- and so on. A search that matches one task and one risk shows both, and a
-- search that matches forty tasks no longer buries everything else.
--
-- Each branch carries a sort_key (lower ranks higher) so that ordering is
-- explicit rather than inherited from the order rows happened to be produced
-- in, which a UNION ALL does not promise.
--
-- The function stays SECURITY INVOKER, so every new branch inherits the
-- caller's row-level security: risks and issues are visible only through
-- app.can_read_project, and documents only through their own policy. Joining
-- to project also filters through project's policy, which means an
-- unauthorized reader loses the row twice.

create or replace function public.global_search(p_query text, p_limit int default 20)
returns table (
  result_type text,
  id uuid,
  title text,
  snippet text,
  href text
)
language sql stable security invoker
set search_path = public
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern),
  hits as (
    (
      select 'task' as result_type, t.id, t.title,
             coalesce(left(t.description, 120), '') as snippet,
             '/my-work?task=' || t.id as href,
             0::bigint as sort_key
      from task t, q where t.title ilike q.pattern and t.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'project', p.id, p.name, coalesce(left(p.outcome, 120), ''),
             '/projects/' || p.id, 0
      from project p, q where p.name ilike q.pattern and p.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'program', pr.id, pr.name, coalesce(left(pr.description, 120), ''),
             '/programs/' || pr.id, 0
      from program pr, q where pr.name ilike q.pattern and pr.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'channel', c.id, '#' || c.slug, coalesce(c.purpose, ''),
             '/channels/' || c.id, 0
      from channel c, q where (c.name ilike q.pattern or c.slug ilike q.pattern)
        and c.archived_at is null
      limit p_limit
    )
    union all
    (
      -- Newest first, here and for documents: recency is the only relevance
      -- signal these two have.
      select 'message', m.id,
             left(m.body, 80),
             'in conversation',
             case when m.channel_id is not null
               then '/channels/' || m.channel_id || '?message=' || m.id
               else '/messages/' || m.conversation_id end,
             (-extract(epoch from m.created_at))::bigint
      from message m, q
      where m.body ilike q.pattern and m.deleted_at is null
      order by 6
      limit p_limit
    )
    union all
    (
      select 'person', u.id, u.full_name, coalesce(u.title, ''),
             '/people?person=' || u.id, 0
      from user_profile u, q where u.full_name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'meeting', mt.id, mt.title, to_char(mt.starts_at, 'YYYY-MM-DD HH24:MI'),
             '/meetings/' || mt.id, 0
      from meeting mt, q where mt.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'event', e.id, e.name, to_char(e.starts_at, 'YYYY-MM-DD'),
             '/events/' || e.id, 0
      from event e, q where e.name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'crm', co.id, co.name, co.category, '/crm/' || co.id, 0
      from crm_organization co, q where co.name ilike q.pattern
      limit p_limit
    )
    union all
    (
      -- Worst first, and live risks ahead of settled ones: if the limit cuts
      -- the list short, it should cut the ones nobody is worried about.
      select 'risk', r.id, r.title,
             p.name || ' · ' || r.status || ' · ' || r.likelihood || '/' || r.impact,
             '/projects/' || r.project_id || '?tab=risks&risk=' || r.id,
             (case when r.status in ('accepted', 'closed') then 10 else 0 end) - r.score
      from risk r
        join project p on p.id = r.project_id, q
      where r.title ilike q.pattern or r.description ilike q.pattern
      order by 6
      limit p_limit
    )
    union all
    (
      select 'issue', i.id, i.title,
             p.name || ' · ' || i.status || ' · ' || i.severity,
             '/projects/' || i.project_id || '?tab=risks&issue=' || i.id,
             (case when i.status in ('resolved', 'closed') then 10 else 0 end)
               - (case i.severity
                    when 'critical' then 4 when 'high' then 3
                    when 'medium' then 2 else 1 end)
      from issue i
        join project p on p.id = i.project_id, q
      where i.title ilike q.pattern or i.description ilike q.pattern
      order by 6
      limit p_limit
    )
    union all
    (
      select 'document', d.id, d.title,
             coalesce(
               left(d.description, 120),
               case when d.kind = 'file' then 'File' else 'Link' end),
             '/documents?document=' || d.id,
             (-extract(epoch from d.created_at))::bigint
      from document d, q
      where (d.title ilike q.pattern or d.description ilike q.pattern)
        and d.archived_at is null
      order by 6
      limit p_limit
    )
  ),
  ranked as (
    select h.*,
           row_number() over (
             partition by h.result_type order by h.sort_key, h.title, h.id
           ) as rank_in_type
    from hits h
  )
  select r.result_type, r.id, r.title, r.snippet, r.href
  from ranked r
  -- Round-robin: the best of each type, then the second of each, and so on.
  -- Within one round the order is a deliberate priority, not alphabetical:
  -- a two-character query is far more often a person or a task than a phrase
  -- buried in a message body, so message matches go last.
  order by r.rank_in_type,
           case r.result_type
             when 'person' then 1 when 'task' then 2 when 'project' then 3
             when 'program' then 4 when 'channel' then 5 when 'meeting' then 6
             when 'event' then 7 when 'document' then 8 when 'risk' then 9
             when 'issue' then 10 when 'crm' then 11 else 12
           end,
           r.sort_key
  limit p_limit;
$$;

comment on function public.global_search(text, int) is
  'Permission-safe cross-entity search. SECURITY INVOKER, so RLS decides what each caller sees. Results are round-robined across types so no type is starved by the limit.';
